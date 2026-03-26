@echo off
title Installation Agent Ulysse - Surveillance PC
color 0A
echo.
echo ========================================
echo    INSTALLATION AGENT ULYSSE PC
echo ========================================
echo.

REM Verifier si Python est installe
python --version >nul 2>&1
if errorlevel 1 (
    echo [!] Python n'est pas installe.
    echo.
    echo Telechargement de Python...
    echo Veuillez installer Python depuis: https://www.python.org/downloads/
    echo IMPORTANT: Cochez "Add Python to PATH" lors de l'installation!
    echo.
    start https://www.python.org/downloads/
    pause
    exit /b
)

echo [OK] Python detecte
python --version
echo.

echo [*] Installation des dependances...
pip install dxcam opencv-python pillow websocket-client pywin32 psutil --quiet

if errorlevel 1 (
    echo [!] Erreur lors de l'installation des dependances
    pause
    exit /b
)

echo [OK] Dependances installees
echo.

REM Telecharger l'agent
echo [*] Telechargement de l'agent Ulysse...
curl -o "%USERPROFILE%\Desktop\ulysse_screen_agent.py" "https://22a3247e-2198-48d3-989c-518df6c234a2-00-3i0oe0nezra07.janeway.replit.dev/downloads/ulysse_screen_agent.py" 2>nul

if exist "%USERPROFILE%\Desktop\ulysse_screen_agent.py" (
    echo [OK] Agent telecharge sur le Bureau
) else (
    echo [!] Telechargement echoue - copiez manuellement le fichier
)

echo.
echo ========================================
echo    INSTALLATION TERMINEE!
echo ========================================
echo.
echo Pour lancer l'agent:
echo 1. Ouvrez l'application Ulysse dans votre navigateur
echo 2. Allez dans "Surveillance PC"
echo 3. Cliquez sur "Demarrer la session"
echo 4. Copiez la commande affichee
echo 5. Collez-la dans ce terminal
echo.
echo OU lancez directement:
echo python "%USERPROFILE%\Desktop\ulysse_screen_agent.py" --help
echo.
pause
