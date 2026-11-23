@echo off
cd /d "%~dp0"
start "" http://localhost:5211
node server.mjs
