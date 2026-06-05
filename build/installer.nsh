!macro customInit
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"

  ${If} $0 != ""
    MessageBox MB_YESNO|MB_ICONQUESTION "ZeFoX Presence Bridge is already installed.$\r$\n$\r$\nDo you want to uninstall it instead?" IDYES uninstall_now IDNO continue_install

    uninstall_now:
      ExecWait '$0'
      Quit

    continue_install:
  ${EndIf}
!macroend