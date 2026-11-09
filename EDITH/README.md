# EDITH — Android voice assistant

"Edith torch on", "Edith WhatsApp padho", "Edith open chrome" — bolne par kaam.
Made by Farhan.

## Install
1. GitHub Releases se `edith-debug.apk` download karo (repo → Releases).
2. Install (unknown sources allow karna padega).
3. App kholo:
   - **BOLO** → mic permission do.
   - **Notification access** → settings me EDITH ko ON karo (WhatsApp/email padhne ke liye).
   - **Always listening** → ON (background me "Edith" sunne ke liye, notification dikhega).
   - **Announce messages** → ON (nayi WhatsApp/email khud bol ke batayegi).

## Commands
| Bolo | Kaam |
|---|---|
| Edith torch on / torch band | LED on/off |
| Edith open WhatsApp / chrome kholo | app khulta hai |
| Edith new tab | Chrome me naya tab |
| Edith search best ai website | Google search |
| Edith google par weather search karo | Google search |
| Edith open flipkart.com | website |
| Edith best website for news | "news official website" search |
| Edith WhatsApp padho | last 3 WhatsApp notifications bolti hai |
| Edith email padho | Gmail/Outlook notifications |
| Edith notifications padho | saari notifications |
| Edith battery / kitne baje / date | info |
| Edith volume badhao / kam / mute | volume |
| Edith WiFi / Bluetooth | settings panel |
| Edith airplane mode on | settings khulti hai (Android block karta hai) |
| Edith note karo doodh lana hai | note save |
| Edith notes padho | last 3 notes |
| Edith help | list |
| Edith stop | sunna band |

## Sach (limits)
- **Airplane mode / mobile data** third-party app se toggle nahi ho sakta — Android permission block karta hai. Root ho to EDITH khud toggle kar leti hai, warna settings khol deti hai.
- WhatsApp/email padhna **notification** se hota hai (jo screen par aata hai), chat history se nahi. Notification access ON hona chahiye.
- Always listening battery khaati hai; sirf Google app wale phones me speech recognition chalta hai.
- Google Assistant ki tarah "Hey Google" offline hotword nahi hai — EDITH har utterance check karti hai, isliye "Edith" bolna zaroori hai.
