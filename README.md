# PND53 WHT Input

A small web app for entering withholding-tax (ภ.ง.ด.53) records into the **Input** sheet of the
`SLC PND53 WHT` Google Sheet. The page is hosted on **GitHub Pages**; a **Google Apps Script**
web app reads and writes the sheet.

```
GitHub Pages (index.html + app.js)  ──fetch──▶  Apps Script Web App (Code.gs)  ──▶  Google Sheet
```

## What it does

| Field | Behaviour |
|---|---|
| Ref | B.E. year of the document date + 3-digit running number (e.g. `2569015`). Assigned by the server at save time, so two people saving at once never get the same number. |
| Date | Typed as `dd/mm/yyyy` in B.E. (slashes are inserted automatically). |
| Payee ID | Drop-down from the **Payee 53** sheet. |
| Name | Filled from Payee 53 → column "ชื่อสำหรับกรอกข้อมูล" (column L). |
| Type | ค่าบริการ / ค่าขนส่ง / ค่าประกัน, any other type already used in the sheet, or a custom entry. |
| Rate | 1% / 3% / 5% buttons, or a custom percentage. Saved as a number formatted `0.00%`. |
| Amount | Two decimals, formatted `#,##0.00`. |
| WHT | Amount × Rate, rounded to 2 decimals. |

* A Thai confirmation popup appears before every save or edit.
* The list shows entries dated in the current and previous month, with an **แก้ไข** (edit) button per row.
  Edits keep the original Ref.
* If the Name or WHT column in the sheet uses formulas, the script copies the formula down instead of
  writing a fixed value, so the existing sheet logic (WHT53 Data, Report, etc.) keeps working.
* With no API URL configured, the page runs in **demo mode** with sample data (nothing is saved) —
  handy for checking the GitHub Pages site before wiring it up.

## Setup

### 1. Apps Script (backend)

1. Open the Google Sheet → **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with `apps-script/Code.gs` from this repo. Save.
3. In the function drop-down choose **setupApiKey** → **Run**. Approve the permissions.
   Open **Execution log** and copy the API key it prints. (Run it again any time to rotate the key.)
4. **Deploy → New deployment** → type **Web app**
   * Execute as: **Me**
   * Who has access: **Anyone**
5. Copy the Web app URL (ends with `/exec`).

> After changing `Code.gs` later: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
> This keeps the same URL.

### 2. GitHub Pages (front end)

1. Create a repository (e.g. `pnd53-wht`) and upload `index.html`, `app.js`, `config.js`, `README.md`
   (and `apps-script/Code.gs` if you want it versioned).
2. Edit `config.js` and paste the Web app URL into `API_URL`. Commit.
3. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`** → Save.
4. Open `https://<your-username>.github.io/<repo>/`, click **ตั้งค่ารหัส** and paste the API key.
   The key is stored only in that browser.

## Security notes

* Never commit the API key. The Web app URL in `config.js` is visible to anyone who can see the site;
  the key is what stops strangers from writing to the sheet.
* GitHub Pages on a free account requires a **public** repository. The repo only contains code — no
  sheet data — but if you'd rather keep it private, use a paid plan or host the same files anywhere static.
* Every request is validated server-side (date, Payee ID must exist in Payee 53, rate 0–100, amount > 0),
  and the Name is always taken from the sheet, not from the browser.

## Assumptions about the sheet

* **Input**: header in row 1, columns `A Ref | B Date | C Payee ID | D Name | E Type | F Rate | G Amount | H WHT`.
  New rows go directly under the last row that has a Ref, and copy that row's formatting.
* **Date** column: if existing dates are real date cells, new dates are written as dates (Gregorian
  internally, displayed in B.E. by your Thai locale); if they are text like `1/1/2568`, text is written.
* **Payee 53**: header in row 1 containing `Payee ID` and `ชื่อสำหรับกรอกข้อมูล…` (falls back to columns B and L).

Sheet and column names are set at the top of `Code.gs` (`CONFIG`, `COL`).
