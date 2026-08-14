# Pido Darts v1.0.4.1 — Aggiornamento Security Hardening

Questa patch non aggiunge nuove modalità di gioco. Rafforza import/backup, rendering dei dati, immagini locali, Service Worker, updater, CSP e build pubblica.

## Repository pubblico — ordine consigliato

1. **NON caricare mai `SOURCE_PRIVATE` nel repository pubblico.**
2. Apri il repository pubblico `Pido-Darts`.
3. Carica/sostituisci con il contenuto della cartella `PUBLIC_FILES` di questo pacchetto.
4. Assicurati che siano comparsi i due nuovi asset:
   - `assets/build/pd-b2e256423edcbdd1.css`
   - `assets/build/pd-382501faef0977d3.js`
5. Attendi che GitHub Pages completi il deploy e verifica che `version.json` mostri `1.0.4.1`.
6. Apri una PWA già installata in v1.0.4 e verifica che compaia l'aggiornamento.
7. Solo dopo il deploy riuscito, elimina dal repository pubblico i vecchi bundle v1.0.4:
   - `assets/build/pd-b2e256423edc.css`
   - `assets/build/pd-b7132562468b.js`

È meglio eliminare i vecchi bundle **dopo** aver pubblicato i nuovi, per evitare una finestra temporanea in cui `index.html` potrebbe puntare a file non ancora presenti.

## Repository privato

Nel repository privato `Pido-Darts-Private` conserva il contenuto di `PidoDarts_v1.0.4.1_SOURCE_PRIVATE.zip`. Qui devono restare i sorgenti modulari, `js/security.js`, strumenti di build e documentazione interna.

## Test consigliati dopo il deploy

- Apri Pido Darts normalmente e controlla che profili/statistiche siano ancora presenti.
- Aggiorna da una PWA già installata v1.0.4 → v1.0.4.1.
- Chiudi e riapri l'app.
- Prova offline dopo almeno un'apertura online della nuova versione.
- Esporta un backup e reimportalo.
- Su iPhone verifica che la PWA continui ad aprirsi come app web e che lo skip-link resti nascosto normalmente.

## Nota

La build PUBLIC riduce la superficie d'attacco e la leggibilità del progetto pubblico, ma il codice frontend eseguito dal browser non può essere reso segreto in modo assoluto. Le future logiche realmente riservate dovranno vivere lato server.
