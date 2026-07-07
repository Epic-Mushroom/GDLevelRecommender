import {sleep, getNSmallest, getRandomInt} from "../utils.js";

const GDDL_API_URL = "https://gdladder.com/api";
const PROXIES = [
    GDDL_API_URL, // directly access gddl from backend
    // `https://corsproxy.io/?${encodeURIComponent(GDDL_API_URL)}`,
    // `https://proxy.cors.sh/${encodeURIComponent(GDDL_API_URL)}`
]

const getRandomProxy = () => PROXIES[getRandomInt(0, PROXIES.length - 1)];

const RATE_LIMIT_DELAY_MS = 7000;

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
    static MAX_BATCH_REQUEST_SIZE = 7;

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
            const response = await fetch(requestURL);
            return response;

        } finally {
            this.numActiveRequests--;

            if (this.queuedRequests.length > 0) {
                this.queuedRequests.shift()();
            }
        }
    }
}

const semaphore = new Semaphore();

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
export async function getAPIResponse(pathVariables, queryParams, retried = false, delayedMs = 0) {
    let resultURL = getRandomProxy();

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
            return await getAPIResponse(pathVariables, queryParams, true, delayedMs + RATE_LIMIT_DELAY_MS);
        }

        console.error(`error with request to url ${resultURL}`);

        if (contentType && contentType.includes("application/json")) {
            throw new APIError(response.status, `${response.status}: ${(await response.json()).message}`);

        } else {
            throw new APIError(response.status, `${response.status}: ${await response.text()}`);

        }
    }

    trackers.numAPISuccesses++;

    if (delayedMs > 0) {
        console.warn(`request to resultURL was delayed by ${delayedMs / 1000}s due to rate limits`);
    }

    return await response.json();
}

/**
 * 
 * @param {string} username 
 */
export async function requestUserID(username) {
    const response = await getAPIResponse(["user", "search"], {limit: 1, name: username});

    if (response.length === 0) {
        return null;

    } else {
        return response[0].ID;
    }
}

/**
 * 
 * @param {string} username 
 */
export async function requestUserProfile(userID) {
    const response = await getAPIResponse(["user", userID], {});

    return response;
}

export async function requestUserSubmissions(userID, minTier, maxTier, pageNum, sortMethod, sortDirection, includeTier = true) {
    if (includeTier) {
        return await getAPIResponse(["user", userID, "submissions"], {
            minTier: Math.max(Math.round(minTier), DEFAULT_MIN_TIER),
            maxTier: Math.min(Math.round(maxTier), DEFAULT_MAX_TIER),
            limit: NUM_SUBMISSIONS_PER_USER_PAGE,
            page: pageNum,
            sort: sortMethod,
            sortDirection: sortDirection,
            onlyIncomplete: false,
            pending: false
        });

    } else {
        return await getAPIResponse(["user", userID, "submissions"], {
            limit: NUM_SUBMISSIONS_PER_USER_PAGE,
            page: pageNum,
            sort: sortMethod,
            sortDirection: sortDirection,
            onlyIncomplete: false,
            pending: false
        });

    }
}

export async function requestLevelInfo(levelID) {
    const response = await getAPIResponse(["level", levelID], {});

    return response;
}

export async function requestLevelSubmissions(levelID, pageNum, sortDirection) {
    const response = await getAPIResponse(["level", levelID, "submissions"], {
        sort: DEFAULT_SUBMISSIONS_SORT,
        sortDirection: sortDirection,
        twoPlayer: false,
        progressFilter: "victors",
        limit: NUM_SUBMISSIONS_PER_LEVEL_PAGE,
        page: pageNum
    });

    return response;
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
            return getNSmallest(skillsMap, limit, ([key, val]) => -val);
        }

    } catch (err) {
        if (err.name === "APIError" && err.status === 429) {
            return [];

        } else {
            throw err;

        }
    }
}