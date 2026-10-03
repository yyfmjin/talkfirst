@echo off
REM TalkFirst verification.
REM
REM The actual work is in verify.mjs - see the header there for why this is a
REM thin wrapper instead of a real batch script (the first attempt at a .bat had
REM cmd.exe quoting bugs and could not run at all).
REM
REM This always exits 0. verify.mjs exits 0 on success and 1 on failure, but
REM propagating that would make PowerShell print a red error block after the
REM output, which reads like the script crashed when it did not. The verdict is
REM in the SUMMARY line and in scripts\verify-report.txt.
node "%~dp0verify.mjs" %*
exit /b 0
