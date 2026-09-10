# Chrome Built-in AI — środowisko testowe

Samodzielna, statyczna strona do testowania wbudowanych w Chrome API AI
w jednym miejscu. Generatywne API korzystają z Gemini Nano; Translator i Language Detector
mają osobne modele. WebMCP to dodatkowy wpis informacyjny o narzędziach dla agentów,
nie lokalny model. Lewe menu to lista API; po prawej dla każdego:

- status z dokumentacji + **live check „czy zadziała u Ciebie"**,
- opis i historia / status wersji,
- przykład użycia (z kopiowaniem),
- **interaktywne demo na żywo** z podglądem pobierania modelu,
- linki do dokumentacji.

Powstało jako materiał pomocniczy do filmu o stanie projektu **Comment Vibe** i wbudowanego
AI w Chrome. Tak jak główne rozszerzenie — **zero zależności, zero narzędzi do budowania**.

## Jak uruchomić

Te API wymagają **bezpiecznego kontekstu**. Do lokalnego testowania użyj `http://localhost`,
a do publikacji HTTPS. Samo `isSecureContext` nie gwarantuje dostępności API:

```bash
cd playground
python3 -m http.server 8000
# otwórz http://localhost:8000
```

Możesz użyć dowolnego istniejącego serwera statycznego — nie instaluj zależności.

## Czego potrzebujesz

- **Chrome na desktopie**: Prompt API jest stabilne na stronach od Chrome 148
  (w rozszerzeniach od 138), a Summarizer, Translator i Language Detector od 138.
  Nie blokujemy nowszych wersji numerem — sprawdzamy obecność API i jego metody.
- Sprzęt, system i wolne miejsce zgodne z [aktualnymi wymaganiami Google](https://developer.chrome.com/docs/ai/get-started).
  Modele pobierają się osobno; rozmiar może się zmieniać. Status sprawdzisz w `chrome://on-device-internals`.
  Sprawdzenie dostępności nie pobiera modelu, ale pierwsze uruchomienie demo może to zrobić.
- **Writer, Rewriter i Proofreader** pozostają w developer trial. Mogą wymagać flag
  lub udziału w Early Preview Program. Nie zakładamy, że wygasły origin trial oznacza wydanie stable.
- **WebMCP** pozostaje w origin trial. Lokalnie Google udostępnia flagę
  `chrome://flags/#enable-webmcp-testing`. Wykrycie `registerTool` nie potwierdza obecności agenta.
- Dema Prompt i Summarizer startują z angielskim tekstem. Obsługiwane języki zależą od API;
  obsługa polskiego w Translatorze lub detektorze nie oznacza obsługi polskiego w Prompt API.

Playground obsługuje także starsze `window.ai.languageModel` i `capabilities()`;
standardowe `LanguageModel` ma pierwszeństwo. Firefoxowe `browser.trial.ml` jest API
rozszerzeń działającym w tle — ta samodzielna strona go nie udostępnia.

> Jeśli demo zwraca błąd, najpierw sprawdź panel dostępności u góry danego API oraz
> sekcję „Twoje środowisko" w zakładce **Przegląd**. Zmiana opcji demo ponawia sprawdzenie
> dla wybranej konfiguracji, np. konkretnej pary języków Translatora.

## Aktualizowanie wersji

Stan dokumentacji zweryfikowano **2026-09-10**: **Chrome 153 Stable**, **154 Beta**.
Według [harmonogramu Google](https://developer.chrome.com/blog/chrome-two-week-start)
Stable 154 jest planowane na **2026-09-22**, a cykl Stable od 153 wynosi dwa tygodnie.
To datowany stan, nie automatycznie aktualizowana lista. Planowane daty nie potwierdzają
wydania ani stabilności poszczególnych API.

Przy następnej aktualizacji:

1. Sprawdź [mapę wydań](https://chromestatus.com/roadmap),
   [status API](https://developer.chrome.com/docs/ai/built-in-apis) oraz dokumentację konkretnego API.
2. Zmień `RELEASE_INFO` w `apis.js`: datę weryfikacji, Stable, Beta, planowaną datę Stable i źródła.
   Menu oraz przegląd korzystają z tych samych danych. Oddzielnie zweryfikuj opisy i historie w `APIS`.
3. Nie awansuj trial do stable na podstawie upływu daty ani numeru przeglądarki.
   Nieznane terminy oznacz jako niepotwierdzone; nie zgaduj przyszłych wersji API.
4. Uruchom `node --test` z katalogu głównego repozytorium i otwórz playground w przeglądarce.
   Testy `test/playground.test.js` używają atrap API i nie pobierają modeli.
   Zaktualizuj oczekiwany stan wersji w testach razem z katalogiem.

## Pliki

```
playground/
├── index.html   # szkielet strony
├── styles.css   # wygląd
├── apis.js      # dane wszystkich API + konfiguracja demo (edytuj tu, by dodać API)
└── app.js       # routing, live-check dostępności, uruchamianie demo
```

Aby dodać lub zmienić API, edytuj tablicę `APIS` w `apis.js` — `app.js` zbuduje resztę.
Opcjonalne `demo.options(values)` zwraca wspólne opcje dla `availability()` i `create()`.
Dema korzystają z `runWithSession`, aby zwalniać sesję zarówno po sukcesie, jak i błędzie.
