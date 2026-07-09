import {sleep, getNBest, getRandomInt} from "../utils.js";

export const GDDL_API_URL = "https://gdladder.com/api";
export const BACKEND_API_URL = "https://gdlevelrecsdb.onrender.com/api";
const PROXIES = [
    GDDL_API_URL, // directly access gddl from backend
    // `https://corsproxy.io/?${encodeURIComponent(GDDL_API_URL)}`,
    // `https://proxy.cors.sh/${encodeURIComponent(GDDL_API_URL)}`
]

const getRandomProxy = () => PROXIES[getRandomInt(0, PROXIES.length - 1)];

const RATE_LIMIT_DELAY_MS = 5000;

export const SKILLS_MAPPING = new Map([
    ["Cube", "1"],
    ["Ship", "2"],
    ["Ball", "3"],
    ["UFO", "4"],
    ["Wave", "5"],
    ["Robot", "6"],
    ["Spider", "7"],
    ["Swing", "20"],
    ["Nerve Control", "8"],
    ["Memory", "9"],
    ["Learny", "10"],
    ["Duals", "11"],
    ["Chokepoints", "12"],
    ["High CPS", "13"],
    ["Timings", "14"],
    ["Flow", "15"],
    ["Overall", "16"],
    ["Gimmicky", "17"],
    ["Fast-Paced", "18"],
    ["Slow-Paced", "19"],
    [null, "0"]
]);

export const NUM_SUBMISSIONS_PER_USER_PAGE = 25;
export const NUM_SUBMISSIONS_PER_LEVEL_PAGE = 30;

export const DEFAULT_MIN_TIER = 1;
export const DEFAULT_MAX_TIER = 39;

export const MAX_PAGES_TO_TRACK_PER_LEVEL = 15; 
// for sorting when gathering submissions from level page
const DEFAULT_SUBMISSIONS_SORT = "enjoyment";

export const trackers = {
    numAPICalls: 0,
    numAPISuccesses: 0,
    numAPIErrors: 0
}

export const flags = {

};

class Semaphore {
    // max how many api calls to make concurrently
    static MAX_BATCH_REQUEST_SIZE = 34;

    constructor() {
        this.numActiveRequests = 0;
        this.queuedRequests = [];
    }

    async addRequestURL(requestURL) {
        if (this.numActiveRequests >= Semaphore.MAX_BATCH_REQUEST_SIZE) {
            await new Promise(resolve => this.queuedRequests.push(resolve));
        }

        this.numActiveRequests++;
        try {
            const response = await fetch(requestURL, {
                method: "GET",
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "application/json"
                }
            });
            return response;

        } finally {
            this.numActiveRequests--;

            if (this.queuedRequests.length > 0) {
                this.queuedRequests.shift()();
            }
        }
    }
}

export const semaphore = new Semaphore();

class APIError extends Error {
    /**
     * 
     * @param {number} status 
     * @param {string} message 
     */
    constructor(status, message) {
        super(message);

        this.name = "APIError";
        this.status = status;
    }
}

/**
 * 
 * @param {Array<string>} pathVariables 
 * @param {Object} queryParams 
 */
export async function getAPIResponse(pathVariables, queryParams, customURL = null, retried = false, delayedMs = 0) {
    let resultURL = (customURL == null) ? getRandomProxy() : customURL;

    for (const variable of pathVariables) {
        resultURL += `/${encodeURIComponent(variable)}`;
    }

    const query = new URLSearchParams(queryParams).toString();
    if (query.length > 0) {
        resultURL += `?${query}`;
    }

    const response = await semaphore.addRequestURL(resultURL);
    trackers.numAPICalls++;

    if (!response.ok) {
        const contentType = response.headers.get("content-type");
        trackers.numAPIErrors++;

        if (response.status === 429 /* && !retried */) {
            await sleep(RATE_LIMIT_DELAY_MS);
            return await getAPIResponse(pathVariables, queryParams, customURL, true, delayedMs + RATE_LIMIT_DELAY_MS);
        }

        console.error(`error with request to url ${resultURL}`);

        if (contentType && contentType.includes("application/json")) {
            throw new APIError(response.status, `${response.status}: ${(await response.json()).message}`);

        } else {
            throw new APIError(response.status, `${response.status}: ${await response.text()}`);

        }
    }

    trackers.numAPISuccesses++;

    const responseJson = await response.json();
    if (delayedMs > 0) {
        console.warn(`request to ${resultURL} was delayed by ${delayedMs / 1000}s due to rate limits`);
        responseJson._rateLimitCounter = delayedMs / RATE_LIMIT_DELAY_MS;
    }

    return responseJson;
}

export async function requestLevelSkills(levelID) {
    const response = await getAPIResponse(["level", levelID, "tags"], {});

    return response;
}

// reformats the API response into something more usable
export async function getLevelSkills(levelID, limit = null) {
    try {
        const tags = await requestLevelSkills(levelID);
        const skillsMap = new Map(); // each skill by id mapped to num of votes

        for (const tag of tags) {
            const skillIDString = SKILLS_MAPPING.get(tag.Tag.Name);
            skillsMap.set(skillIDString, tag.ReactCount);
        }

        if (limit == null) {
            return skillsMap;
        } else {
            return getNBest(skillsMap, limit, ([key, val]) => -val);
        }

    } catch (err) {
        if (err.name === "APIError" && err.status === 429) {
            return [];

        } else {
            throw err;

        }
    }
}