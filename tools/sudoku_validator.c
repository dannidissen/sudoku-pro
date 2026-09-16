/**
 * Sudoku Pro - High-Performance Mathematical Validator & Benchmark CLI
 *
 * Implements:
 * 1. Fast Bitwise MRV Backtracking (Minimum Remaining Values heuristic with early exit at 2 solutions)
 * 2. Sequential Backtracking for benchmark sanity check (--compare flag)
 * 3. Strict 81-char validation & initial conflict detection
 * 4. Microsecond timing (QueryPerformanceCounter / CLOCK_MONOTONIC)
 * 5. Visual board rendering & unambiguous status reporting
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <time.h>
#endif

/* ------------------------------------------------------------------------- */
/* Hardware Intrinsics & Bit Manipulation                                     */
/* ------------------------------------------------------------------------- */

#if defined(_MSC_VER) && !defined(__clang__)
#include <intrin.h>
static inline int count_bits(uint32_t x) {
    return (int)__popcnt(x);
}
static inline int find_first_bit(uint32_t x) {
    unsigned long index;
    _BitScanForward(&index, x);
    return (int)index;
}
#else
static inline int count_bits(uint32_t x) {
    return __builtin_popcount(x);
}
static inline int find_first_bit(uint32_t x) {
    return __builtin_ctz(x);
}
#endif

/* ------------------------------------------------------------------------- */
/* High-Resolution Microsecond Timer                                         */
/* ------------------------------------------------------------------------- */

static double get_time_microseconds(void) {
#if defined(_WIN32)
    static LARGE_INTEGER freq;
    static int initialized = 0;
    if (!initialized) {
        QueryPerformanceFrequency(&freq);
        initialized = 1;
    }
    LARGE_INTEGER counter;
    QueryPerformanceCounter(&counter);
    return ((double)counter.QuadPart * 1000000.0) / (double)freq.QuadPart;
#else
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ((double)ts.tv_sec * 1000000.0) + ((double)ts.tv_nsec / 1000.0);
#endif
}

/* ------------------------------------------------------------------------- */
/* Data Structures & Coordinate Helpers                                      */
/* ------------------------------------------------------------------------- */

typedef struct {
    int8_t cells[81];
    uint16_t row_mask[9];
    uint16_t col_mask[9];
    uint16_t box_mask[9];
} SudokuBoard;

typedef struct {
    uint64_t nodes_explored;
    int solutions_count;
    double elapsed_us;
} SolverStats;

static inline int get_row(int idx) {
    return idx / 9;
}

static inline int get_col(int idx) {
    return idx % 9;
}

static inline int get_box(int idx) {
    return (idx / 27) * 3 + ((idx % 9) / 3);
}

static inline uint16_t get_candidates(const SudokuBoard *board, int idx) {
    int r = get_row(idx);
    int c = get_col(idx);
    int b = get_box(idx);
    return (~(board->row_mask[r] | board->col_mask[c] | board->box_mask[b])) & 0x1FF;
}

/* ------------------------------------------------------------------------- */
/* Input Parsing & Initial Board Validation                                  */
/* ------------------------------------------------------------------------- */

static bool parse_and_validate(const char *input, SudokuBoard *board,
                               int *empty_cells, int *num_empty,
                               int *clues_count, char *err_buf, size_t err_size) {
    size_t len = strlen(input);
    if (len != 81) {
        snprintf(err_buf, err_size,
                 "Invalid length: Expected exactly 81 characters, but got %zu.", len);
        return false;
    }

    memset(board, 0, sizeof(SudokuBoard));
    *num_empty = 0;
    *clues_count = 0;

    for (int i = 0; i < 81; i++) {
        char ch = input[i];
        int r = get_row(i);
        int c = get_col(i);
        int b = get_box(i);

        if (ch == '0' || ch == '.') {
            board->cells[i] = 0;
            empty_cells[(*num_empty)++] = i;
        } else if (ch >= '1' && ch <= '9') {
            int digit = ch - '0';
            uint16_t bit = (uint16_t)(1 << (digit - 1));

            // Check for initial contradictions in row, col, or box
            if (board->row_mask[r] & bit) {
                snprintf(err_buf, err_size,
                         "Initial conflict: Duplicate digit '%d' in Row %d (Col %d).",
                         digit, r + 1, c + 1);
                return false;
            }
            if (board->col_mask[c] & bit) {
                snprintf(err_buf, err_size,
                         "Initial conflict: Duplicate digit '%d' in Column %d (Row %d).",
                         digit, c + 1, r + 1);
                return false;
            }
            if (board->box_mask[b] & bit) {
                snprintf(err_buf, err_size,
                         "Initial conflict: Duplicate digit '%d' in 3x3 Box %d (Row %d, Col %d).",
                         digit, b + 1, r + 1, c + 1);
                return false;
            }

            board->cells[i] = (int8_t)digit;
            board->row_mask[r] |= bit;
            board->col_mask[c] |= bit;
            board->box_mask[b] |= bit;
            (*clues_count)++;
        } else {
            snprintf(err_buf, err_size,
                     "Invalid character '%c' at position %d (Row %d, Col %d). Only 1-9, 0, or '.' are allowed.",
                     ch, i + 1, r + 1, c + 1);
            return false;
        }
    }

    return true;
}

/* ------------------------------------------------------------------------- */
/* Algorithm 1: Bitwise MRV Backtracking (Primary Engine)                    */
/* ------------------------------------------------------------------------- */

static void solve_mrv(SudokuBoard *board, int *empty_cells, int num_empty,
                      SolverStats *stats, int8_t *first_solution) {
    stats->nodes_explored++;

    if (num_empty == 0) {
        stats->solutions_count++;
        if (stats->solutions_count == 1 && first_solution) {
            memcpy(first_solution, board->cells, 81 * sizeof(int8_t));
        }
        return;
    }

    // Heuristic MRV: Locate cell with minimum remaining candidates
    int best_index = -1;
    int min_cands = 10;
    uint16_t best_mask = 0;

    for (int i = 0; i < num_empty; i++) {
        int cell = empty_cells[i];
        uint16_t mask = get_candidates(board, cell);
        int cands = count_bits(mask);

        // Immediate pruning: dead-end cell has 0 candidates
        if (cands == 0) {
            return;
        }

        if (cands < min_cands) {
            min_cands = cands;
            best_index = i;
            best_mask = mask;
            // Early break if naked single found (1 candidate)
            if (cands == 1) {
                break;
            }
        }
    }

    int chosen_cell = empty_cells[best_index];
    int r = get_row(chosen_cell);
    int c = get_col(chosen_cell);
    int b = get_box(chosen_cell);

    // Swap chosen cell to the end for O(1) removal
    empty_cells[best_index] = empty_cells[num_empty - 1];

    uint16_t mask = best_mask;
    while (mask) {
        int bit = find_first_bit(mask);
        int digit = bit + 1;
        uint16_t digit_bit = (uint16_t)(1 << bit);
        mask &= (mask - 1); // BLSR: clear lowest set bit

        // Place digit
        board->cells[chosen_cell] = (int8_t)digit;
        board->row_mask[r] |= digit_bit;
        board->col_mask[c] |= digit_bit;
        board->box_mask[b] |= digit_bit;

        solve_mrv(board, empty_cells, num_empty - 1, stats, first_solution);

        // Backtrack
        board->row_mask[r] &= ~digit_bit;
        board->col_mask[c] &= ~digit_bit;
        board->box_mask[b] &= ~digit_bit;
        board->cells[chosen_cell] = 0;

        // Early exit: Stop once non-uniqueness (>=2 solutions) is proven
        if (stats->solutions_count >= 2) {
            break;
        }
    }

    // Restore empty cells array
    empty_cells[best_index] = chosen_cell;
}

/* ------------------------------------------------------------------------- */
/* Algorithm 2: Sequential Backtracking (Control / Comparison Engine)        */
/* ------------------------------------------------------------------------- */

static void solve_sequential(SudokuBoard *board, const int *empty_cells, int curr_idx, int num_empty,
                             SolverStats *stats, int8_t *first_solution) {
    stats->nodes_explored++;

    if (curr_idx == num_empty) {
        stats->solutions_count++;
        if (stats->solutions_count == 1 && first_solution) {
            memcpy(first_solution, board->cells, 81 * sizeof(int8_t));
        }
        return;
    }

    int cell = empty_cells[curr_idx];
    int r = get_row(cell);
    int c = get_col(cell);
    int b = get_box(cell);

    uint16_t mask = get_candidates(board, cell);
    if (mask == 0) {
        return;
    }

    while (mask) {
        int bit = find_first_bit(mask);
        int digit = bit + 1;
        uint16_t digit_bit = (uint16_t)(1 << bit);
        mask &= (mask - 1); // BLSR

        board->cells[cell] = (int8_t)digit;
        board->row_mask[r] |= digit_bit;
        board->col_mask[c] |= digit_bit;
        board->box_mask[b] |= digit_bit;

        solve_sequential(board, empty_cells, curr_idx + 1, num_empty, stats, first_solution);

        board->row_mask[r] &= ~digit_bit;
        board->col_mask[c] &= ~digit_bit;
        board->box_mask[b] &= ~digit_bit;
        board->cells[cell] = 0;

        if (stats->solutions_count >= 2) {
            break;
        }
    }
}

/* ------------------------------------------------------------------------- */
/* Grid Rendering & Output Helpers                                           */
/* ------------------------------------------------------------------------- */

static void print_grid(const int8_t *cells, const char *title) {
    if (title) {
        printf("\n[%s]\n", title);
    }
    printf("+-------+-------+-------+\n");
    for (int r = 0; r < 9; r++) {
        printf("| ");
        for (int c = 0; c < 9; c++) {
            int val = cells[r * 9 + c];
            if (val == 0) {
                printf(". ");
            } else {
                printf("%d ", val);
            }
            if ((c + 1) % 3 == 0) {
                printf("| ");
            }
        }
        printf("\n");
        if ((r + 1) % 3 == 0) {
            printf("+-------+-------+-------+\n");
        }
    }
}

static void print_usage(const char *prog_name) {
    printf("Sudoku Pro - Mathematical Validator & Benchmark CLI (C99/C11)\n");
    printf("Usage:\n");
    printf("  %s <81-character-puzzle> [--compare]\n\n", prog_name);
    printf("Options:\n");
    printf("  --compare, -c    Run both Bitwise MRV and Sequential Backtracking to compare performance.\n");
    printf("  --help, -h       Show this help message.\n\n");
    printf("Input Format:\n");
    printf("  Exactly 81 characters. Digits 1-9 for clues, '0' or '.' for empty cells.\n");
    printf("Example:\n");
    printf("  %s 050703060007000800000816000000030000005000100730040086906000204840572093000409000 --compare\n", prog_name);
}

/* ------------------------------------------------------------------------- */
/* Main CLI Execution Entry                                                  */
/* ------------------------------------------------------------------------- */

int main(int argc, char *argv[]) {
#if defined(_WIN32)
    // Enable UTF-8 codepage on Windows console for emoji support
    SetConsoleOutputCP(65001);
#endif

    const char *puzzle_str = NULL;
    bool compare_mode = false;

    if (argc < 2) {
        print_usage(argv[0]);
        return 1;
    }

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--compare") == 0 || strcmp(argv[i], "-c") == 0) {
            compare_mode = true;
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            print_usage(argv[0]);
            return 0;
        } else if (argv[i][0] != '-') {
            puzzle_str = argv[i];
        } else {
            fprintf(stderr, "Error: Unknown option '%s'\n", argv[i]);
            print_usage(argv[0]);
            return 1;
        }
    }

    if (!puzzle_str) {
        fprintf(stderr, "Error: No puzzle string provided.\n");
        print_usage(argv[0]);
        return 1;
    }

    SudokuBoard board;
    int empty_cells[81];
    int num_empty = 0;
    int clues_count = 0;
    char err_buf[256];

    if (!parse_and_validate(puzzle_str, &board, empty_cells, &num_empty, &clues_count, err_buf, sizeof(err_buf))) {
        fprintf(stderr, "\n========================================================\n");
        fprintf(stderr, "❌ VALIDATION FAILED: %s\n", err_buf);
        fprintf(stderr, "Status: ❌ UNSOLVABLE (Invalid Initial Input)\n");
        fprintf(stderr, "========================================================\n");
        return 2;
    }

    print_grid(board.cells, "Input Puzzle");
    printf("\nPuzzle Clues: %d | Empty Cells: %d\n", clues_count, num_empty);

    // Run Algorithm 1: Bitwise MRV Backtracking
    SudokuBoard mrv_board = board;
    int mrv_empty[81];
    memcpy(mrv_empty, empty_cells, num_empty * sizeof(int));

    int8_t mrv_solution[81] = {0};
    SolverStats mrv_stats = {0, 0, 0.0};

    double start_mrv = get_time_microseconds();
    solve_mrv(&mrv_board, mrv_empty, num_empty, &mrv_stats, mrv_solution);
    double end_mrv = get_time_microseconds();
    mrv_stats.elapsed_us = end_mrv - start_mrv;

    // Optional Algorithm 2: Sequential Backtracking
    SudokuBoard seq_board = board;
    int8_t seq_solution[81] = {0};
    SolverStats seq_stats = {0, 0, 0.0};

    if (compare_mode) {
        double start_seq = get_time_microseconds();
        solve_sequential(&seq_board, empty_cells, 0, num_empty, &seq_stats, seq_solution);
        double end_seq = get_time_microseconds();
        seq_stats.elapsed_us = end_seq - start_seq;
    }

    // Output Result Status
    printf("\n========================================================\n");
    if (mrv_stats.solutions_count == 1) {
        printf("STATUS: ✅ VALID & UNIQUE (Exactly 1 valid solution)\n");
    } else if (mrv_stats.solutions_count == 0) {
        printf("STATUS: ❌ UNSOLVABLE (0 solutions found)\n");
    } else {
        printf("STATUS: ⚠️ INVALID / MULTIPLE (Multiple solutions detected; puzzle is ambiguous)\n");
    }
    printf("========================================================\n");

    if (mrv_stats.solutions_count >= 1) {
        print_grid(mrv_solution, "First Valid Solution Found");
    }

    // Performance & Benchmark Metrics
    printf("\n--- Performance Metrics (Bitwise MRV) ---\n");
    printf("Nodes Explored:   %llu\n", (unsigned long long)mrv_stats.nodes_explored);
    printf("Time Elapsed:     %.2f µs (%.3f ms)\n", mrv_stats.elapsed_us, mrv_stats.elapsed_us / 1000.0);

    if (compare_mode) {
        printf("\n================================================================================\n");
        printf("                       ALGORITHM COMPARISON BENCHMARK\n");
        printf("================================================================================\n");
        printf("%-26s | %-24s | %-24s\n", "Metric", "Bitwise MRV (Engine 1)", "Sequential (Engine 2)");
        printf("---------------------------+--------------------------+-------------------------\n");
        printf("%-26s | %-24llu | %-24llu\n", "Nodes Explored",
               (unsigned long long)mrv_stats.nodes_explored,
               (unsigned long long)seq_stats.nodes_explored);

        char mrv_time_str[32], seq_time_str[32];
        snprintf(mrv_time_str, sizeof(mrv_time_str), "%.2f µs (%.3f ms)", mrv_stats.elapsed_us, mrv_stats.elapsed_us / 1000.0);
        snprintf(seq_time_str, sizeof(seq_time_str), "%.2f µs (%.3f ms)", seq_stats.elapsed_us, seq_stats.elapsed_us / 1000.0);
        printf("%-26s | %-24s | %-24s\n", "Execution Time", mrv_time_str, seq_time_str);

        printf("%-26s | %-24d | %-24d\n", "Solutions Discovered",
               mrv_stats.solutions_count, seq_stats.solutions_count);
        printf("---------------------------+--------------------------+-------------------------\n");

        if (seq_stats.nodes_explored > 0) {
            int64_t nodes_saved = (int64_t)seq_stats.nodes_explored - (int64_t)mrv_stats.nodes_explored;
            double nodes_pct = ((double)nodes_saved / (double)seq_stats.nodes_explored) * 100.0;
            printf("Nodes Pruned / Saved:      %lld nodes (%.2f%% search space reduction)\n",
                   (long long)nodes_saved, nodes_pct);
        }

        if (mrv_stats.elapsed_us > 0.001) {
            double speedup = seq_stats.elapsed_us / mrv_stats.elapsed_us;
            printf("MRV Speedup Factor:        %.2fx faster\n", speedup);
        }
        printf("================================================================================\n");
    }

    return (mrv_stats.solutions_count == 1) ? 0 : (mrv_stats.solutions_count == 0 ? 1 : 2);
}
