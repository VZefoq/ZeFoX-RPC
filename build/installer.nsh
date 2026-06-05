!macro customInit
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"

  ${If} $0 != ""
    ${If} $0 == "${VERSION}"
      MessageBox MB_OK|MB_ICONINFORMATION "You already have the latest version of ZeFoX Presence Bridge installed."
      Quit
    ${EndIf}
  ${EndIf}
!macroend
