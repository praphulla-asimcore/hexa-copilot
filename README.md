# Hexa CoPilot — Finance Intelligence

AI-powered CFO assistant for Hexamatics Group. Powered by Google Gemini + Zoho Books MCP.

## Quick Start

1. Open `index.html` in a browser (Chrome/Edge recommended)
2. Enter your Anthropic API key (`sk-ant-...`)
3. Optionally enter Zoho Books Organisation IDs (comma-separated)
4. Click **Connect & Launch** — or click **Try Demo Mode** to explore without an API key

## File Structure

```
hexa-copilot/
├── index.html          # Main app shell
├── css/
│   └── style.css       # Full Hexa-branded stylesheet
├── js/
│   ├── orgs.js         # 8 entity configurations (HSPL, PTHIT, HNPL...)
│   ├── prompts.js      # Gemini system prompts per financial module
│   ├── gemini.js       # AI engine: Anthropic API + Zoho Books MCP
│   ├── renderer.js     # Response & module view renderer
│   └── app.js          # Main application controller
└── assets/
    └── hexa-logo.png   # Hexa brand logo
```

## Features

- **8 Entities** — HSPL, PTHIT, HNPL, HCI, HMCL, HTPL, HBL, HSSB
- **AI Chat** — Natural language queries answered by Gemini with live Zoho Books data
- **Module Views** — Invoices, Payments, Expenses, AP/Bills, Reports, Intercompany, Tax
- **Live Data** — Zoho Books MCP integration pulls real-time financial data
- **Demo Mode** — Full app experience with realistic sample data (no API key needed)
- **IFRS-aware** — Accounting treatment notes, IAS/IFRS references, audit-ready responses
- **IPO-ready** — Intercompany disclosures, contingent liabilities, Bursa ACE awareness

## API Keys

- **Anthropic API Key**: Get from https://console.anthropic.com
- **Zoho Books Org IDs**: Found in Zoho Books → Settings → Organisation Profile
- Keys are stored in memory only — never logged or transmitted

## Deployment

This is a static HTML app. Deploy by:
- Uploading all files to any web server / hosting (Vercel, Netlify, S3)
- Or simply opening `index.html` locally in Chrome

## Security Note

For production deployment, move the API key to a backend proxy to avoid exposing it in the browser.
