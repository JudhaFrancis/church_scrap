const puppeteer = require('puppeteer');
const { USER_AGENT } = require('./config');
const { sleep } = require('./utils');

async function initBrowser() {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1366, height: 768 });
    return { browser, page };
}

async function extractCoords(page) {
    let url = page.url();
    const coordRegex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
    let match = url.match(coordRegex);
    if (match) return { lat: match[1], lon: match[2] };

    const dataRegex = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/;
    match = url.match(dataRegex);
    if (match) return { lat: match[1], lon: match[2] };

    return null;
}

async function searchMaps(page, query, targetState, verifyText = null) {
    try {
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
        console.log(`    Searching: ${query}`);

        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(4000);

        // Check if it's a list of results
        const isList = await page.evaluate(() => {
            return !!document.querySelector('[role="article"]') || !!document.querySelector('.m67qEc');
        });

        if (isList) {
            console.log(`    ⚠️ Multiple results found. Selecting first one...`);
            const firstResult = await page.$('[role="article"], .m67qEc');
            if (firstResult) {
                await firstResult.click();
                await sleep(5000); // Wait for the specific result to load
            }
        }

        const coords = await extractCoords(page);
        if (coords) {
            const verification = await page.evaluate((state, vTexts) => {
                const text = document.body.innerText.toLowerCase();
                const stateMatch = text.includes(state.toLowerCase());
                
                let textMatch = true;
                if (vTexts) {
                    const targets = Array.isArray(vTexts) ? vTexts : [vTexts];
                    textMatch = targets.every(t => text.includes(t.toLowerCase()));
                }
                
                return { stateMatch, textMatch };
            }, targetState, verifyText);

            if (verification.stateMatch && verification.textMatch) {
                return { status: 'success', ...coords, isMultiple: isList };
            } else if (!verification.stateMatch) {
                console.log(`    ❌ State mismatch: Result not found in ${targetState}.`);
                return { status: 'not_found' };
            } else {
                console.log(`    ❌ Accuracy check failed: "${verifyText}" not found in result.`);
                return { status: 'not_found' };
            }
        } else {
            return { status: 'not_found' };
        }
    } catch (error) {
        console.error(`    Search error: ${error.message}`);
        return { status: 'not_found' };
    }
}

module.exports = {
    initBrowser,
    searchMaps
};
