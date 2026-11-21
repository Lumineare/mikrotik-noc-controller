@echo off
title MikroTik Controller
cd /d "%~dp0"
echo Starting MikroTik Controller on http://127.0.0.1:8090 ...
C:\Python314\python.exe app.py
pause