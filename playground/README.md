# Chrome Built-in AI — środowisko testowe

Samodzielna, statyczna strona do testowania **wszystkich wbudowanych w Chrome API AI**
(Gemini Nano) w jednym miejscu. Lewe menu to lista API; po prawej dla każdego:

- status z dokumentacji + **live check „czy zadziała u Ciebie"**,
- opis i historia / status wersji,
- przykład użycia (z kopiowaniem),
- **interaktywne demo na żywo** z podglądem pobierania modelu,
- linki do dokumentacji.

Powstało jako materiał pomocniczy do filmu o stanie projektu **Comment Vibe** i wbudowanego
AI w Chrome. Tak jak główne rozszerzenie — **zero zależności, zero narzędzi do budowania**.

## Jak uruchomić

Te API wymagają **bezpiecznego kontekstu**, więc otwórz stronę przez `http://localhost`,
a nie z pliku `file://`:

```bash
cd playground
python3 -m http.server 8000
# otwórz http://localhost:8000
```

(albo dowolny inny statyczny serwer, np. `npx serve`).

## Czego potrzebujesz

- **Chrome 138+** na desktopie (Windows / macOS 13+ / Linux) — wtedy stabilne API
  (Prompt dla rozszerzeń, Summarizer, Translator, Language Detector) działają bez flag.
- Sprzęt spełniający wymagania Gemini Nano; model (~2 GB) pobiera się przy pierwszym użyciu.
- **API w fazie trial** (Writer, Rewriter, Proofreader) mogą wymagać włączenia flag w
  `chrome://flags` lub udziału w Early Preview Program — panel „Czy zadziała u Ciebie?"
  pokaże realny stan w Twojej przeglądarce.

> Jeśli demo zwraca błąd, najpierw sprawdź panel dostępności u góry danego API oraz
> sekcję „Twoje środowisko" w zakładce **Przegląd**.

## Pliki

```
playground/
├── index.html   # szkielet strony
├── styles.css   # wygląd
├── apis.js      # dane wszystkich API + konfiguracja demo (edytuj tu, by dodać API)
└── app.js       # routing, live-check dostępności, uruchamianie demo
```

Aby dodać lub zmienić API, edytuj tablicę `APIS` w `apis.js` — `app.js` zbuduje resztę.
