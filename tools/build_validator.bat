@echo off
cd /d "%~dp0\.."
gcc -O3 -march=native -flto -Wall tools/sudoku_validator.c -o sudoku_validator.exe
if %ERRORLEVEL% EQU 0 (
    echo [OK] sudoku_validator.exe compiled successfully with full optimizations.
) else (
    echo [ERROR] Compilation failed.
)
pause
