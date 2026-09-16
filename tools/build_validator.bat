@echo off
setlocal
cd /d "%~dp0\.."

where gcc >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Building with GCC...
    gcc -O3 -march=native -flto -Wall -Wextra tools\sudoku_validator.c -o sudoku_validator.exe
    set "BUILD_EXIT=%ERRORLEVEL%"
    goto :report
)

where clang >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Building with Clang...
    clang -O3 -march=native -flto -Wall -Wextra tools\sudoku_validator.c -o sudoku_validator.exe
    set "BUILD_EXIT=%ERRORLEVEL%"
    goto :report
)

where cl >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Building with Microsoft C/C++...
    cl /nologo /O2 /W4 /Fe:sudoku_validator.exe tools\sudoku_validator.c
    set "BUILD_EXIT=%ERRORLEVEL%"
    goto :report
)

echo [ERROR] No supported C compiler was found.
echo Install GCC or LLVM, or run this script from a Visual Studio Developer Command Prompt.
exit /b 1

:report
if "%BUILD_EXIT%"=="0" (
    echo [OK] sudoku_validator.exe compiled successfully.
) else (
    echo [ERROR] Compilation failed with exit code %BUILD_EXIT%.
)
exit /b %BUILD_EXIT%
