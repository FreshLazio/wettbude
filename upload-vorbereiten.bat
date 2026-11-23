@echo off
rem Stellt im Ordner "upload" genau die Dateien zusammen, die auf GitHub gehoeren.
cd /d "%~dp0"
if exist upload rmdir /s /q upload
mkdir upload
copy /y server.mjs upload\ >nul
copy /y fd.mjs upload\ >nul
copy /y tsdb.mjs upload\ >nul
copy /y model.mjs upload\ >nul
copy /y flashscore.mjs upload\ >nul
copy /y accounts.mjs upload\ >nul
copy /y package.json upload\ >nul
copy /y clauder.json upload\ >nul
copy /y u19.json upload\ >nul
xcopy /e /i /y /q public upload\public >nul
xcopy /e /i /y /q seed upload\seed >nul
echo Fertig. Im Ordner "upload" liegt alles fuer GitHub.
explorer upload
