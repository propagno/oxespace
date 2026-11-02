# Following and answering from your phone

> Pair your phone over Wi-Fi, follow your agents and answer requests safely, with no cloud in between.

<!-- About this page: Slice S4 · Filled by: MOBILE · Items: B9, M1, M5–M9, B9.2 · partial: written from the Android app's screens and Settings › Devices on main on 10/31. The desktop gateway (#180) and the app chain (#222 → #236) haven't landed; until they do, Settings › Devices says the phone connection isn't available in this version. Check each step on the real app when they land. -->

Also in: [pt-BR](../pt-BR/04-celular.md)

## What you can do

- Turn on the phone connection on your computer
- Pair the phone with the code
- See whether the phone is connected
- Answer a request from the phone
- Remove a paired phone

## How to

### Turn on the phone connection on your computer

1. On the computer, open **Settings › Devices**.
2. Under **Phone connection**, turn on **Let phones on this network connect**.
3. Read **Before phones can connect** and click **Turn on**.
4. On Windows, the system asks whether OXESpace may accept connections: allow it on **private networks** (your home or
   office Wi-Fi). Public networks can stay unchecked.
5. The section now says **Listening on …, port …**.

When it's off, the connection opens no port.

### Pair the phone with the code

1. On the computer, under **Pair a phone**, click **Show pairing code**. The code works once and lasts two minutes.
2. On the phone, open OXESpace and tap **Pair with your computer**.
3. Tap **Allow camera** if the phone asks. The camera only reads the code; nothing it sees leaves the phone.
4. Point the camera at the code on the computer's screen.
5. The phone shows **Confirm on your computer** and a verification code.
6. On the computer, the question **Pair …?** shows the same code. If it matches the phone's, click **Pair**; if not,
   click **Refuse**.
7. The phone shows **Paired**. Tap **Done**.

If the computer's address on the network changes, use **Enter the computer's address** in the phone's menu and type
the address shown in **Settings › Devices** (for example `192.168.0.12`).

### See whether the phone is connected

- On the phone, the home screen says **Connected to …** (or **Connecting to …**).
- On the computer, **Paired phones** shows each device as **Connected** or **Not connected**, with when it was last
  seen.

### Answer a request from the phone

<!-- TO FILL (MOBILE): steps of the Requests tab and the request screen, with biometrics, when the #222 → #236
chain lands. Use the glossary's words (Allow / Deny) and mobile-audit-1.4 (P1, P2). -->

1. …

### Remove a paired phone

1. On the computer, under **Paired phones**, click **Remove** next to the device.
2. Confirm. The phone is disconnected right away and can no longer connect; to use it again, pair it again.

## What OXESpace guarantees

- The phone connection is **off** by default; when off, no port is open.
- When on, OXESpace listens only on private network addresses, over an encrypted connection that only paired phones
  can use. Nothing is exposed to the internet.
- The phone checks the computer's certificate fingerprint before trusting the connection; another device at the same
  address is refused.
- A pairing code works once and expires in 2 minutes; at most 5 phones per computer.
- Your computer's network name is never sent: the phone sees the name you choose in **Name of this computer**.

## If something goes wrong

- **"The code expired."** Show a new one on the computer and scan it within 2 minutes.
- **"That code was already used."** Show a new code.
- **"Another device answered at that address, not your computer. Nothing was sent."** You may be on another Wi-Fi.
  Check the network and pair again.
- **"This code points outside your local network."** OXESpace only pairs on the same Wi-Fi.
- **"Too many pairing attempts."** Wait 2 minutes and try again.
- **"Your computer already has 5 paired devices."** Remove one in **Settings › Devices**.
- **"Camera access is off for OXESpace."** Tap **Open settings** and turn the camera on.
- **"Couldn't reach your computer."** Check that it's on, on the same Wi-Fi, and that the phone connection is on.
- **"… removed this phone."** The device was removed on the computer. Pair again.
- **"… uses a different version of OXESpace."** Update the app or OXESpace on your computer.

## On the phone

This page is about the phone.

## Known limits

- Android only in this version.
- The phone and the computer must be on the same local network; there is no access over the internet.
- What only the computer may answer (guarded requests, permissions, questions with secrets) can't be answered from
  the phone: it tells you to answer on the computer.

<!-- Screenshots: `docs/guide/assets/S4/<name>.en.<light|dark>.png`, from the Paparazzi goldens and the pairing e2e. -->
