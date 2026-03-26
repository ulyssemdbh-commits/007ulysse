@echo off
title Agent Ulysse - Surveillance PC
color 0A
echo.
echo ========================================
echo    AGENT ULYSSE - SURVEILLANCE PC
echo ========================================
echo.

set AGENT_PATH=%USERPROFILE%\Desktop\ulysse_screen_agent.py

if not exist "%AGENT_PATH%" (
    echo [!] Agent non trouve sur le Bureau.
    echo Veuillez d'abord executer l'installateur.
    pause
    exit /b
)

echo [OK] Agent trouve
echo.
echo Entrez l'URL WebSocket de la session Ulysse:
echo (Copiez-la depuis l'interface Ulysse > Surveillance PC)
echo.
set /p WS_URL="URL: "

if "%WS_URL%"=="" (
    echo [!] Aucune URL fournie
    pause
    exit /b
)

echo.
echo.
echo Entrez votre User ID (par defaut: 1 pour le proprietaire):
set /p USER_ID="User ID [1]: "
if "%USER_ID%"=="" set USER_ID=1

echo.
echo [*] Lancement de l'agent...
echo.
python "%AGENT_PATH%" --server "%WS_URL%" --user-id %USER_ID%

pause
