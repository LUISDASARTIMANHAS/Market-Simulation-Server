@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1

docker build --tag market-simulation-server:latest --file Dockerfile .
set "BUILD_EXIT_CODE=%ERRORLEVEL%"

popd
exit /b %BUILD_EXIT_CODE%