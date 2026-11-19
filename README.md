# Go7 Flicks

Go7 Flicks is a local Windows app. You make a channel folder on that computer, start a ranking or a split, cut it, and export an MP4. There is no Go7 Flicks account and no cloud project.

The link to send is [https://go7studio.com/products/go7-flicks](https://go7studio.com/products/go7-flicks). Anyone with that link can open it. No Go7 account and no GitHub login. Wes can send it to a friend who is not in the family.

That page is not live until the studio site change is deployed. The Windows setup file is not posted yet either. The button on the page stays on the install steps so it does not open a missing file. When `go7studio/go7-flicks` is a public repo, the button should download from `https://github.com/go7studio/go7-flicks/releases/latest`. A public release file does not ask for a GitHub account. A private repo would.

## Install on another PC

The file to run is `Go7Flicks-Setup-<version>.exe`. This checkout builds `Go7Flicks-Setup-0.1.0.exe`. Take that file only from the Go7 Studio page.

The installer is not code-signed. Windows will say unknown publisher. Choose More info, then Run anyway.

The install is per user. It adds a desktop shortcut and a Start menu shortcut named Go7Flicks. Uninstall leaves the app data in place.

1. Run `Go7Flicks-Setup-<version>.exe`.
2. Open Go7 Flicks.
3. Library, New channel, pick a folder. That folder is the channel.

Copy a channel folder to another PC and use Open folder. The flicks come with the folder. Connections and saved templates stay on the PC that saved them.

Building the installer is `npm run dist:win` on Windows. The steps are in `WINDOWS.md`.
