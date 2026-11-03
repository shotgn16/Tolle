; Extra steps for the Windows installer / uninstaller (included by electron-builder).
!macro customUnInstall
  ; If Tolle was set up as a server, remove its start-up task and firewall rule (needs admin – ignored otherwise).
  ExecWait '"$INSTDIR\resources\server\tolle-server.exe" service uninstall --scope system --json'
!macroend
