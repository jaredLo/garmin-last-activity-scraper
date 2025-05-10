# Garmin Last Activity Scraper

This scraper is designed to fetch the most recent activity from your Garmin Connect account and upload its splits data to a Google Sheet. Currently, it's specifically built and tested for Pool Swim activities, though it may work with other activity types.

## Important Notes

- The scraper only fetches the most recent activity that appears on the first page of your Garmin Connect activities list
- Currently tested and verified only with Pool Swim activities
- Other activity types may work but have not been verified

## Prerequisites

- Node.js v22 (using nvm)
- Bun package manager
- Garmin Connect account
- Google Cloud Project with Sheets API enabled
- Service account with Google Sheets access

## Environment Variables

Create a `.env` file with the following variables:

```bash
# Garmin Connect credentials
GARMIN_EMAIL=your-email
GARMIN_PASSWORD=your-garmin-password
GARMIN_TARGET_ACTIVITY_TYPE_STRING='Pool Swim'  # Change this if you want to track different activities

# Google Sheets configuration
SERVICE_ACCOUNT_KEY_BASE64=your-base64-encoded-service-account-json
GOOGLE_SHEET_ID=your-google-sheet-id
```

To get the required Google credentials:
1. Create a project in Google Cloud Console
2. Enable the Google Sheets API
3. Create a service account and download the JSON key
4. Convert the JSON key to base64: `base64 -i service-account.json | tr -d '\n'`
5. Create a Google Sheet and share it with the service account email

## Installation

```bash
# Install nvm if you haven't already
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install and use Node.js v22
nvm install 22
nvm use 22

# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install
```

## Running the Scraper

```bash
bun run index.ts
```

## Known Issues

- The scraper may fail if Garmin's website structure changes
- Authentication headers might need to be refreshed periodically
- Some activity types might not have compatible split data formats

## License

MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
