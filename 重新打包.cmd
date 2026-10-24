@echo off
setlocal
set "DSH=E:\Program Files\DSH\source\dsh"
set "NODE=E:\Program Files\DSH\source\dsh\apps\desktop\.desktop-build\development\home\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
set "PKG=%DSH%\packages\client\ui-fish"

echo [1/2] typecheck...
cd /d "%DSH%"
"%NODE%" "%DSH%\node_modules\typescript\bin\tsc" -b "%PKG%\tsconfig.client.json"
if errorlevel 1 goto fail

echo [2/2] bundle...
cd /d "%PKG%"
set "DSH_BUILD_FACE=client"
"%NODE%" "%DSH%\node_modules\tsdown\dist\run.mjs" --config-loader native
if errorlevel 1 goto fail

echo.
echo 打包完成。回到 DSH 窗口按 Ctrl+R 刷新即可看到改动。
pause
exit /b 0

:fail
echo.
echo 打包失败，往上翻看第一条报错。
pause
exit /b 1
