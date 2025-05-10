import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fetch from 'node-fetch';
import { google } from 'googleapis';


const GARMIN_EMAIL = process.env.GARMIN_EMAIL || '';
const GARMIN_PASSWORD = process.env.GARMIN_PASSWORD || '';
const GARMIN_TARGET_ACTIVITY_TYPE_STRING = process.env.GARMIN_TARGET_ACTIVITY_TYPE_STRING || 'Pool Swim';


async function uploadToGoogleSheets(csv: string, activityDate: string) {
    const keyBase64 = process.env.SERVICE_ACCOUNT_KEY_BASE64;
    if (!keyBase64) throw new Error("Missing SERVICE_ACCOUNT_KEY_BASE64");

    const credentials = JSON.parse(Buffer.from(keyBase64, 'base64').toString('utf8'));

    const sheetId = process.env.GOOGLE_SHEET_ID; 

    if (!credentials || !sheetId) {
        throw new Error('Missing SERVICE_ACCOUNT_KEY or GOOGLE_SHEET_ID');
    }


    const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(credentials),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    let sheetTitle = activityDate; // e.g. '2025-04-13'
    const rows = csv.trim().split('\n').map(row => row.split(','));

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
            requests: [
                {
                    addSheet: {
                        properties: {
                            title: sheetTitle,
                        },
                    },
                },
            ],
        },
    }).catch(async (err) => {
        if (
            err?.errors?.[0]?.reason === 'duplicate' ||
            err.message.includes('already exists')
        ) {
            console.warn(`Sheet "${sheetTitle}" already exists. Trying "${sheetTitle}-2"...`);
            const fallbackTitle = `${sheetTitle}-2`;

            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: sheetId,
                requestBody: {
                    requests: [
                        {
                            addSheet: {
                                properties: {
                                    title: fallbackTitle,
                                },
                            },
                        },
                    ],
                },
            });

            sheetTitle = fallbackTitle;
        } else {
            console.error(`❌ Failed to create sheet tab "${sheetTitle}":`, err);
            throw err;
        }
    });

    await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${sheetTitle}!A1`,
        valueInputOption: 'RAW',
        requestBody: {
            values: rows,
        },
    });

    console.log(`✅ Uploaded to Google Sheet tab: ${sheetTitle}`);
}

puppeteer.use(StealthPlugin());

// I took out decimal laps, it's too confusing imo.
// but if you prefer to get the decimal intervals too, just take out the wholeLaps variable and replace with laps
function jsonToCsv(laps: any[], activityId: string): string {
    if (!laps || laps.length === 0) {
        console.warn("Lap data (lapDTOs) was null, undefined, or empty.");
        return "No lap data found.";
    }

    const wholeLaps = laps.filter((lap) => {
        const idx = lap.lapIndex;
        return typeof idx === 'number'
            ? Number.isInteger(idx)
            : !String(idx).includes('.');
    });

    wholeLaps.sort((a, b) => a.lapIndex - b.lapIndex);

    const formatTime = (seconds: number): string => {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds - minutes * 60;
        return `${minutes}:${secs.toFixed(1).padStart(4, '0')}`;
    };

    const formatPace = (seconds: number): string => {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.round(seconds - minutes * 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };

    const computeBestPace = (lengths: any[]): string => {
        let best = Infinity;
        for (const dto of lengths) {
            if (dto.distance && dto.duration && dto.distance > 0) {
                const pace = (dto.duration / dto.distance) * 100;
                if (pace < best) best = pace;
            }
        }
        return best === Infinity ? '' : formatPace(best);
    };

    const aggregateSwimStroke = (lengths: any[]): string => {
        const strokes = lengths.map((l) => l.swimStroke).filter((s) => s && s !== '--');
        const unique = Array.from(new Set(strokes));
        return unique.length === 0 ? '' : unique.length === 1 ? unique[0] : 'Mixed';
    };

    // copying how Garmin does it, but again, i removed the decimals interval
    const headers = [
        '', 'Intervals', 'Swim Stroke', 'Lengths', 'Distance', 'Time', 'Cumulative Time', 'Avg Pace', 'Best Pace',
        'Avg. Swolf', 'Avg HR', 'Max HR', 'Total Strokes', 'Avg Strokes', 'Calories'
    ];

    const rows: string[] = [];
    let cumulative = 0;

    let summary = {
        lengths: 0,
        distance: 0,
        duration: 0,
        avgPaceSum: 0,
        bestPace: Infinity,
        avgSWOLFSum: 0,
        avgHRSum: 0,
        maxHR: 0,
        totalStrokes: 0,
        avgStrokesSum: 0,
        calories: 0,
        count: 0,
    };

    for (const lap of wholeLaps) {
        cumulative += lap.duration;
        const avgPace = lap.averageSpeed > 0 ? 100 / lap.averageSpeed : 0;
        const bestPace = computeBestPace(lap.lengthDTOs);
        const swimStroke = lap.swimStroke || aggregateSwimStroke(lap.lengthDTOs);
        const lengthsVal = lap.numberOfActiveLengths ?? lap.lengthDTOs?.length ?? '';

        summary.count++;
        summary.lengths += Number(lengthsVal);
        summary.distance += lap.distance ?? 0;
        summary.duration += lap.duration ?? 0;
        summary.avgPaceSum += avgPace || 0;
        summary.bestPace = Math.min(summary.bestPace, bestPace ? parseFloat(bestPace.replace(':', '.')) * 60 : Infinity);
        summary.avgSWOLFSum += lap.averageSWOLF ?? 0;
        summary.avgHRSum += lap.averageHR ?? 0;
        summary.maxHR = Math.max(summary.maxHR, lap.maxHR ?? 0);
        summary.totalStrokes += lap.totalNumberOfStrokes ?? 0;
        summary.avgStrokesSum += lap.averageStrokes ?? 0;
        summary.calories += lap.calories ?? 0;

        const row = [
            '""',
            lap.lapIndex,
            swimStroke,
            lengthsVal,
            lap.distance ?? '',
            formatTime(lap.duration),
            formatTime(cumulative),
            avgPace ? formatPace(avgPace) : '',
            bestPace,
            lap.averageSWOLF ?? '',
            lap.averageHR ?? '',
            lap.maxHR ?? '',
            lap.totalNumberOfStrokes ?? '',
            lap.averageStrokes ?? '',
            lap.calories ?? ''
        ];
        rows.push(row.join(','));
    }

    //summary just like in Garmin splits export csv
    const summaryRow = [
        '""',
        'Summary',
        '--',
        summary.lengths,
        summary.distance,
        formatTime(summary.duration),
        formatTime(summary.duration),
        summary.count ? formatPace(summary.avgPaceSum / summary.count) : '',
        summary.bestPace !== Infinity ? formatPace(summary.bestPace) : '',
        Math.round(summary.avgSWOLFSum / summary.count) || '',
        Math.round(summary.avgHRSum / summary.count) || '',
        summary.maxHR,
        summary.totalStrokes,
        Math.round(summary.avgStrokesSum / summary.count) || '',
        summary.calories
    ];

    const linkRow = [
        '""',
        'Link',
        `https://connect.garmin.com/modern/activity/${activityId}`,
        '', '', '', '', '', '', '', '', '', '', '', ''
    ];

    return [headers.join(','), ...rows, summaryRow.join(','), linkRow.join(',')].join('\n');
}


// this is where it collects things like your JWT, Cookie
// and the latest activity (according to TARGET_ACTIVITY_TYPE_STRING, in my case I want it to be "Pool Swim", so it takes the latest Pool Swim)
export const handler = async () => {
    console.log('Starting handler');

    if (!GARMIN_EMAIL || !GARMIN_PASSWORD) {
        console.error('Error: GARMIN_EMAIL and GARMIN_PASSWORD environment variables must be set.');
        return { statusCode: 400, body: JSON.stringify({ message: 'Missing credentials' }) };
    }

    let browser;
    let capturedAuthHeader: string | null = null;
    let capturedCookieHeader = null;
    let activityId = null;

    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({
            headless: 'shell',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        await page.setRequestInterception(true);
        console.log('Request interception enabled.');

        let captureResolver: (value: unknown) => void;
        let captureRejector: (arg0: Error) => void;
        const capturePromise = new Promise((resolve, reject) => {
            captureResolver = resolve;
            captureRejector = reject;
        });

        page.on('request', async (request) => {
            if (request.url().includes('/device-service/deviceservice/user-device/') && !capturedAuthHeader) {
                const headers = request.headers();
                capturedAuthHeader = headers['authorization'] || null;
                capturedCookieHeader = headers['cookie'] || null;
                if (capturedAuthHeader && capturedCookieHeader) {
                    console.log('✅ Captured Authorization and Cookie headers from device-service request.');
                    if (captureResolver) { // @ts-ignore
                        captureResolver();
                    }
                } else {
                    console.warn('⚠️ Matched device-service request but failed to extract auth/cookie headers.');
                    console.warn('Headers found:', Object.keys(headers));
                }
                if (!request.isInterceptResolutionHandled()) await request.continue();
            } else {
                if (!request.isInterceptResolutionHandled()) {
                    try { await request.continue(); } catch (error) {/* ignore */}
                }
            }
        });
        page.on('requestfailed', request => {
            if (
                request.url().includes('/device-service/deviceservice/user-device/') &&
                !capturedAuthHeader
            ) {
                console.error(`❌ Target device-service request failed! URL: ${request.url()}, Failure: ${request.failure()?.errorText}`);
                if (captureRejector) captureRejector(new Error(`Target device-service request failed: ${request.failure()?.errorText}`));
            }
        });

        console.log('Navigating to Garmin login');
        await page.goto('https://sso.garmin.com/portal/sso/en-US/sign-in?clientId=GarminConnect&service=https%3A%2F%2Fconnect.garmin.com%2Fmodern', { waitUntil: 'networkidle2' });

        console.log('Entering credentials...');
        await page.waitForSelector('input#email', { visible: true, timeout: 15000 });
        await page.type('input#email', GARMIN_EMAIL, { delay: 50 });
        await page.waitForSelector('input#password', { visible: true, timeout: 10000});
        await page.type('input#password', GARMIN_PASSWORD, { delay: 50 });

        console.log('Submitting login & waiting for redirect and header capture...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }),
            page.click('button[type=submit]'),
            Promise.race([
                capturePromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout: Did not capture device-service headers within 30 seconds.')), 30000))
            ])
        ]);
        console.log('Login complete and required headers captured.');
        await page.setRequestInterception(false);
        console.log('Request interception disabled.');

        console.log('Navigating to activities list...');
        await page.goto('https://connect.garmin.com/modern/activities', { waitUntil: 'networkidle0' });
        console.log(`Waiting for activities list and searching for "${GARMIN_TARGET_ACTIVITY_TYPE_STRING}"...`);
        await page.waitForSelector('div[class^="ActivityList_activitiesListItems"] a[href*="/activity/"]', { timeout: 30000 });

        activityId = await page.evaluate((activityTypeString) => {
            const links = Array.from(document.querySelectorAll('div[class^="ActivityList_activitiesListItems"] a[href*="/activity/"]'));
            const targetLink = links.find(link => link.textContent?.trim().includes(activityTypeString));
            if (targetLink) {
                const href = targetLink.getAttribute('href');
                return href ? href.split('/').pop() : null;
            }
            return null;
        }, GARMIN_TARGET_ACTIVITY_TYPE_STRING);

        if (!activityId) {
            console.error(`No "${GARMIN_TARGET_ACTIVITY_TYPE_STRING}" activity found on the first page.`);
            throw new Error(`Target activity "${GARMIN_TARGET_ACTIVITY_TYPE_STRING}" not found.`);
        }
        console.log(`Found latest "${GARMIN_TARGET_ACTIVITY_TYPE_STRING}" activity ID:`, activityId);

        console.log('Closing browser...');
        await browser.close();
        browser = null;

    } catch (error) {
        console.error('Error during Puppeteer phase:', error);
        if (browser) {
            //@ts-ignore
            try { await page.setRequestInterception(false); } catch(e) {}
            await browser.close();
        }
        return { statusCode: 500, body: JSON.stringify({ message: 'Puppeteer or Header Capture failed', error: error instanceof Error ? error.message : String(error) }) };
    }

    if (!capturedAuthHeader || !capturedCookieHeader) {
        console.error('Failed to capture necessary headers. Cannot proceed with fetch.');
        return { statusCode: 500, body: JSON.stringify({ message: 'Header capture failed' }) };
    }
    if (!activityId) {
        console.error('Failed to find activity ID. Cannot proceed with fetch.');
        return { statusCode: 404, body: JSON.stringify({ message: 'Activity ID not found' }) };
    }

    try {
        console.log(`Workspaceing splits for activity ID: ${activityId} using captured headers...`);

        const splitsUrl = `https://connect.garmin.com/activity-service/activity/${activityId}/splits?_=${Date.now()}`;
        const referer = `https://connect.garmin.com/modern/activity/${activityId}`;

        console.log(`Workspaceing splits from: ${splitsUrl}`);

        const headers = {
            'Authorization': capturedAuthHeader,
            'Cookie': capturedCookieHeader,
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': referer,
            'X-Requested-With': 'XMLHttpRequest',
            'NK': 'NT',
            'DI-Backend': 'connectapi.garmin.com',
            'X-app-ver': '5.11.3.3',
            'X-lang': 'en-US',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
        };

        const response = await fetch(splitsUrl, {
            method: 'GET',
            headers: headers,
        });

        console.log(`Workspace status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Split fetch failed: ${response.status} ${response.statusText}`);
            console.error(`URL: ${splitsUrl}`);
            console.error(`Response Text: ${errorText.substring(0, 500)}...`);
            throw new Error(`Failed to fetch splits: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as any;
        const csv = jsonToCsv(data?.lapDTOs, activityId);
        if (csv.includes('No lap data found.')) {
            console.warn('API returned data, but no laps (lapDTOs) were found in the response.');
        }


        const activityDate = new Date(data.lapDTOs?.[0]?.startTimeGMT).toLocaleDateString('en-CA');
        await uploadToGoogleSheets(csv, activityDate);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Processed splits successfully',
                csv,
                splits: data.lapDTOs
            }),
        };

    } catch (error) {
        console.error('Error during Fetching phase:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Fetching or processing failed', error: error instanceof Error ? error.message : String(error) }) };
    }
};

handler()
    .then(result => console.log('Handler finished:', result))
    .catch(error => console.error('Unhandled error in handler:', error));