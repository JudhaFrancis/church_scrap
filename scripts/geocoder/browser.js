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

async function searchMaps(page, query, targetState, verifyText = null, contextText = null) {
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
            console.log(`    ⚠️ Multiple results found. Searching for best match...`);
            const bestIndex = await page.evaluate((vText, cText) => {
                const items = Array.from(document.querySelectorAll('[role="article"], .m67qEc'));
                const verify = (vText || '').toLowerCase();
                const contexts = (Array.isArray(cText) ? cText : [cText]).filter(Boolean).map(t => t.toLowerCase());

                let bestIdx = 0;
                let maxScore = -1;

                items.forEach((item, idx) => {
                    const text = item.innerText.toLowerCase();
                    let score = 0;

                    // Check for verifyText (Village/Church name)
                    if (verify && text.includes(verify)) {
                        score += 10;
                        // Check if it's likely the title
                        const title = item.querySelector('.qBF1Pd')?.innerText.toLowerCase() || '';
                        if (title === verify) score += 20;
                    }

                    // Check for context (District/Block)
                    contexts.forEach(ctx => {
                        if (text.includes(ctx)) score += 5;
                    });

                    if (score > maxScore) {
                        maxScore = score;
                        bestIdx = idx;
                    }
                });
                return bestIdx;
            }, verifyText, contextText);

            const results = await page.$$('[role="article"], .m67qEc');
            if (results[bestIndex]) {
                console.log(`    Selected result #${bestIndex + 1} based on relevance.`);
                await results[bestIndex].click();
                await sleep(5000);
            }
        }

        const coords = await extractCoords(page);
        if (coords) {
            const verification = await page.evaluate((state, vTexts) => {
                const text = document.body.innerText.toLowerCase();
                const title = document.querySelector('h1')?.innerText.toLowerCase() || '';

                const stateMatch = text.includes(state.toLowerCase());

                let textMatch = true;
                let exactMatch = false;

                if (vTexts) {
                    const targets = Array.isArray(vTexts) ? vTexts : [vTexts];
                    textMatch = targets.every(t => text.includes(t.toLowerCase()));

                    // Exact match check: is the main target (usually the first or only one) exactly the title?
                    const mainTarget = targets[0].toLowerCase();
                    if (title === mainTarget || title.includes(mainTarget)) {
                        // More strict: title should ideally BE the target or very close
                        if (title === mainTarget) exactMatch = true;
                    }
                }

                return { stateMatch, textMatch, exactMatch };
            }, targetState, verifyText);

            if (verification.stateMatch && (verification.textMatch || verification.exactMatch)) {
                return {
                    status: 'success',
                    ...coords,
                    isMultiple: isList,
                    isExactMatch: verification.exactMatch
                };
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