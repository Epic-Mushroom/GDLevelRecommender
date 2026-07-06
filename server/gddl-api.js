import {sleep, getNSmallest} from "./utils.js";

const GDDL_API_URL = "https://gdladder.com/api";
const ALT_BASE_URL = "/api"; // for redirects
const PROXY_URL = `https://corsproxy.io/?${encodeURIComponent(GDDL_API_URL)}`;

const RATE_LIMIT_DELAY_MS = 7000;

const DEBUG_USERNAME = "DEBUGDEBUG93229"; // entering this username will use debug data

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

const DEFAULT_MAIN_USER_SUBMISSIONS_SORT = "enjoyment";
const DEFAULT_MAIN_USER_SUBMISSIONS_SORT_DIRECTION = "desc";
// at max how many of the main user's rated levels per enjoyment rating are sent an api request
// for example if the user has 140 levels rated an 8/10, only [this value] 8/10 levels will be sent a request
// this value is ONLY used when finding users who share levels in common, NOT at the start to get the main user's submissions
const MAX_USER_LEVELS_PER_ENJ_RATING = 5;
// at max how many submissions per level to put into dataManager, because getting like 5,000 submissions per level is probably
// a globillion requests total and we don't want that 
const MAX_SUBMISSIONS_TO_TRACK_PER_LEVEL = 90; 
// for sorting when gathering submissions from level page
const DEFAULT_SUBMISSIONS_SORT = "enjoyment";
// up to [this value] users will have their ratings collected
// this is different from recs.MAX_OTHER_USERS_TO_TRACK since not all users will have their ratings collected
const MAX_OTHER_USERS_TO_COLLECT_FROM = 20;
// [this value] is added to max tier and subtracted from min tier when searching for levels from other users' pages
// this is because a user's sent rating is not always the same as the actual rating
const TIER_RANGE_OFFSET = 5;
// up to [this value] levels from other users will be tracked
const MAX_OTHER_USER_SUBMISSIONS = 50;
// for sorting when gathering submissions from other users' pages
const DEFAULT_OTHER_USER_SUBMISSIONS_SORT = "levelRating";
const DEFAULT_OTHER_USER_SUBMISSIONS_SORT_DIRECTION = "desc";

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
export async function getAPIResponse(pathVariables, queryParams, retried = false) {
    let resultURL = GDDL_API_URL;

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
            console.log("rate limited... waiting 7000 ms to retry");
            await sleep(RATE_LIMIT_DELAY_MS);
            return await getAPIResponse(pathVariables, queryParams, true);
        }

        if (contentType && contentType.includes("application/json")) {
            throw new APIError(response.status, `${response.status}: ${(await response.json()).message}`);

        } else {
            throw new APIError(response.status, `${response.status}: ${await response.text()}`);

        }
    }

    trackers.numAPISuccesses++;
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