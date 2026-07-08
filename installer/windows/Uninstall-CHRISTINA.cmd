@echo off
setlocal
set "APPDIR=%LOCALAPPDATA%\Programs\CHRISTINA"
echo This will remove the CHRISTINA application files from:
echo %APPDIR%
echo.
choice /C YN /M "Continue"
if errorlevel 2 exit /b 0
cd /d "%TEMP%"
timeout /t 2 /nobreak >nul
rmdir /s /q "%APPDIR%"
del /q "%USERPROFILE%\Desktop\CHRISTINA.lnk" 2>nul
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\CHRISTINA.lnk" 2>nul
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Uninstall CHRISTINA.lnk" 2>nul
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\CHRISTINA" /f >nul 2>&1
echo CHRISTINA application files were removed. Your private books and user data were not deleted.
pause
