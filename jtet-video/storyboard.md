# J-TET (Jharkhand TET) — 60 second 2D explainer

**Final files**

- `jtet-60s-hindi.mp4` — **Hindi voiceover ke saath** (1080×1920, 30 fps, 60.0s, H.264 + AAC)
- `jtet-60s.mp4` — wahi video, sirf music bed (voice ke bina)
- `storyboard.png` (8 frames), `thumbnail.jpg`, `vo/*.mp3` (narration clips)

## Hindi narration (voiceover in video)

| Start | Scene | Hindi line |
|---|---|---|
| 0:00.35 | J-TET · JAC Ranchi | झारखंड टेट — जेटेट। साठ सेकंड में पूरी जानकारी। |
| 0:04.42 | JTET kya hai? | दो पेपर: पेपर वन क्लास एक से पाँच, पेपर टू क्लास छह से आठ। डेढ़ सौ सवाल, डेढ़ सौ नंबर, ढाई घंटे। |
| 0:12.68 | Paper 1 pattern | पेपर वन में पाँच सेक्शन, हर एक तीस नंबर — चाइल्ड डेवलपमेंट, लैंग्वेज वन, लैंग्वेज टू, मैथ्स और ईवीएस। जनरल को नब्बे नंबर चाहिए। |
| 0:22.18 | Paper 2 pattern | पेपर टू में भी तीन तीस नंबर के सेक्शन, और फिर मैथ्स और साइंस या सोशल साइंस के साठ नंबर। रीजनल लैंग्वेज — खोरठा, नागपुरी, मुंडारी, संताली — का पेपर भी होता है। |
| 0:32.49 | Eligibility | पेपर वन के लिए बारहवीं और डी एल एड। पेपर टू के लिए ग्रेजुएशन और बी एड। फाइनल ईयर वाले भी अप्लाई कर सकते हैं। |
| 0:39.43 | Qualifying marks | जनरल के लिए साठ परसेंट, बी सी ई बी सी और ई डब्ल्यू एस पचपन, एस सी एस टी और दिव्यांग पचास। सर्टिफिकेट लाइफटाइम। |
| 0:47.34 | 5-step plan | प्लान सिंपल है: सिलेबस प्रिंट करो, एन सी ई आर टी क्लास तीन से आठ, पिछले पाँच साल के पेपर, हर हफ्ते मॉक टेस्ट, और रीजनल लैंग्वेज की प्रैक्टिस। |
| 0:56.25 | Outro | रोज़ तीन चार घंटे और एक मॉक। ऑल द बेस्ट! |

Tempo: speech ko 1.17x kiya gaya taaki 60s me fit ho; music bed voice ke neeche duck hota hai.

## Scenes (visual)

| Time | Scene | Motion |
|---|---|---|
| 0:00–0:04 | Intro — J-TET, JAC Ranchi | title scale-in, pulsing rings, badge pop |
| 0:04–0:12 | JTET kya hai? — Paper 1 / Paper 2 / 150Q·150M·2:30 | cards staggered |
| 0:12–0:22 | Paper 1 pattern — 5 bars (30 each) | bars fill + count-up |
| 0:22–0:32 | Paper 2 pattern — 30/30/30/60/60 | bars fill |
| 0:32–0:39 | Eligibility — 12th+D.El.Ed / Graduation+B.Ed | cards rise, check badges |
| 0:39–0:47 | Qualifying — 60% (90/150) donut | donut sweep 0→60% |
| 0:47–0:56 | 5-step plan | timeline grows, nodes tick |
| 0:56–1:00 | Outro — All the best! | pop + save/share chip |

## Facts (JAC)

150 Q / 150 marks / 2:30 hrs · MCQ · no negative marking · Gen 60% (90/150), BC/EBC/EWS 55%, SC/ST/PwD 50% · certificate lifetime · Paper 1 = Class 1–5, Paper 2 = Class 6–8.

## Rebuild
```bash
cd /home/user/jtet-video
/home/user/.venv-video/bin/python music.py
/home/user/.venv-video/bin/python build_audio.py
OUT_NAME=jtet-60s-hindi.mp4 /home/user/.venv-video/bin/python render.py
```
