import * as recs from "./recommendations.js";
import {dataManager} from "./recommendations.js"
import {getNSmallest, sleep} from "./utils.js";

const BACKEND_API_URL = "https://gdlevelrecsdb.onrender.com/api";// db that contains only necessary data for this site
const GDDL_API_URL = "https://gdladder.com/api";
const BACKEND_REDIRECT_URL = "/api"; // redirects to backend
const GDDL_REDIRECT_URL = "/gddlapi"; // redirects to gddl api
const PROXY_URL = `https://corsproxy.io/?${encodeURIComponent(GDDL_API_URL)}`;

const RATE_LIMIT_DELAY_MS = 250;

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

const NUM_SUBMISSIONS_PER_USER_PAGE = 25;
const NUM_SUBMISSIONS_PER_LEVEL_PAGE = 30;

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
async function getAPIResponse(pathVariables, queryParams, useGDDL = false, retried = false) {
    let resultURL = (useGDDL) ? GDDL_REDIRECT_URL : BACKEND_REDIRECT_URL;

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

        if (response.status === 429 && !retried) {
            console.log("rate limited... waiting 250 ms to retry");
            await sleep(RATE_LIMIT_DELAY_MS);
            return await getAPIResponse(pathVariables, queryParams, useGDDL, true);
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
async function requestUserID(username) {
    const response = await getAPIResponse(["user", "search"], {limit: 1, name: username}, true);

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
async function requestUserProfile(userID) {
    const response = await getAPIResponse(["user", userID], {});

    return response;
}

async function requestUserSubmissionsGDDL(userID, minTier, maxTier, pageNum, sortMethod, sortDirection, includeTier = true) {
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
        }, true);

    } else {
        return await getAPIResponse(["user", userID, "submissions"], {
            limit: NUM_SUBMISSIONS_PER_USER_PAGE,
            page: pageNum,
            sort: sortMethod,
            sortDirection: sortDirection,
            onlyIncomplete: false,
            pending: false
        }, true);

    }
}

async function requestUserSubmissions(userID) {
    const response = await getAPIResponse(["user", userID], {});
    const ratingsArr = response.ratings;

    return ratingsArr;
}

export async function requestLevelInfo(levelID) {
    const response = await getAPIResponse(["level", levelID], {});

    return response;
}

async function requestLevelSubmissionsGDDL(levelID, pageNum, sortDirection) {
    const response = await getAPIResponse(["level", levelID, "submissions"], {
        sort: DEFAULT_SUBMISSIONS_SORT,
        sortDirection: sortDirection,
        twoPlayer: false,
        progressFilter: "victors",
        limit: NUM_SUBMISSIONS_PER_LEVEL_PAGE,
        page: pageNum
    }, true);

    return response;
}

async function requestLevelVictors(levelID) {
    const response = await getAPIResponse(["level", levelID], {});
    const victorUserIDs = response.sub;

    return victorUserIDs;
}

async function requestLevelSkillsGDDL(levelID) {
    const response = await getAPIResponse(["level", levelID, "tags"], {}, true);

    return response;
}

// reformats the GDDL API response into something more usable
export async function getLevelSkillsGDDL(levelID, limit = null) {
    try {
        const tags = await requestLevelSkillsGDDL(levelID);
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

export async function getLevelSkills(levelID, limit = null) {
    try {
        const levelInfo = await getAPIResponse(["level", levelID], {});
        const skillsMap = new Map(); // each skill by id mapped to num of votes

        for (const tag of levelInfo.sk) {
            skillsMap.set(`${tag.tagID}`, tag.count);
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

/**
 * 
 * @param {string} username 
 */
async function registerUserSubmissions(
    userID, username = null, isOther = false, minTier = DEFAULT_MIN_TIER, 
    maxTier = DEFAULT_MAX_TIER, limit = 19999, sortMethod = DEFAULT_MAIN_USER_SUBMISSIONS_SORT,
    sortDirection = DEFAULT_MAIN_USER_SUBMISSIONS_SORT_DIRECTION
) {
    if (username == null) {
        const userProfile = await requestUserProfile(userID);  
        username = userProfile.Name;
    }

    console.log(`attempting to register submissions for ${username}`);

    let numSubmissionsRegistered = 0;

    // const registration = (response) => {
    //     for (const submission of response.submissions) {
    //         const argsData = [
    //             submission.Level.ID, submission.Enjoyment, submission.Level.Rating,
    //             submission.Level.Enjoyment, submission.Level.Meta.Name, submission.Level.Meta.Publisher?.name
    //         ]

    //         if (isOther) {
    //             dataManager.addOtherUserEnjRating(userID, username, ...argsData);

    //         } else {
    //             dataManager.addMainUserEnjRating(...argsData);

    //         }

    //         numSubmissionsRegistered++;
    //     }

    //     // console.log(`${numSubmissionsRegistered} submissions registered for ${username} so far`);
    // }

    // // find the max page first by making a request to the first page
    // const response = await requestUserSubmissionsGDDL(userID, minTier, maxTier, 0, sortMethod, sortDirection, isOther);
    // registration(response); // register first page of submissions
    // const maxPageNum = Math.ceil(Math.min(response.total, limit) * 1.0 / NUM_SUBMISSIONS_PER_USER_PAGE) - 1;

    // for (let pageNum = 1; pageNum <= maxPageNum; pageNum++) {
    //     await requestUserSubmissionsGDDL(userID, minTier, maxTier, pageNum, sortMethod, sortDirection, isOther).then(registration);
    // }

    const allRatings = await requestUserSubmissions(userID);
    for (const rating of allRatings) {
        const levelInfoResponse = await requestLevelInfo(rating.l);
        const levelInfo = {
            actualRating: levelInfoResponse.t,
            actualEnj: levelInfoResponse.e,
            levelName: levelInfoResponse.n,
            levelAuthor: levelInfoResponse.a
        }

        if (isOther) {
            dataManager.addOtherUserEnjRating(
                userID, username, rating.l, rating.e,
                levelInfo.actualRating, levelInfo.actualEnj,
                levelInfo.levelName, levelInfo.levelAuthor
            );

        } else {
            dataManager.addMainUserEnjRating(
                rating.l, rating.e,
                levelInfo.actualRating, levelInfo.actualEnj,
                levelInfo.levelName, levelInfo.levelAuthor
            );

        }

        dataManager.addLevelInfo(rating.l, levelInfo);
        numSubmissionsRegistered++;
    }

    console.log(`submission registration for ${username} finished: ${numSubmissionsRegistered} submissions registered`);
}

async function registerAllOtherUserCommonSubmissions() {
    let numTotalSubmissionsRegistered = 0;
    // index = enjoyment
    const levelsPerEnjoyment = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    console.log("attempting to register all other users' common submissions");

    for (const levelID of dataManager.mainUserEnjProfile.ratingMap.keys()) {
        let numSubmissionsThisLevelRegistered = 0;

        try {
            const mainUserEnjRating = dataManager.mainUserEnjProfile.getEnjoyment(levelID);

            if (mainUserEnjRating == null || levelsPerEnjoyment[mainUserEnjRating] >= MAX_USER_LEVELS_PER_ENJ_RATING) {
                // console.log(`skipping getting other user submissions from level ID ${levelID}`);
                // if (levelsPerEnjoyment[mainUserEnjRating] >= MAX_USER_LEVELS_PER_ENJ_RATING) {
                //     console.log(`   because of passing threshold for enj rating ${mainUserEnjRating}`);
                // }
                continue;
            }

            // let maxPageNum = Math.ceil(MAX_SUBMISSIONS_TO_TRACK_PER_LEVEL * 1.0 / NUM_SUBMISSIONS_PER_LEVEL_PAGE) - 1;

            // for (let pageNum = 0; pageNum <= maxPageNum ; pageNum++) {
            //     const sortDirection = (mainUserEnjRating >= 6) ? "desc" : "asc";

            //     await requestLevelSubmissionsGDDL(levelID, pageNum, sortDirection).then((response) => {
            //         for (const submission of response.submissions) {
            //             if (submission.Enjoyment == null) {
            //                 continue;
            //             }

            //             // this will NOT add level metadata (actual rating, actual enj, level name) since those
            //             // values aren't present in the level/ID/submissions request for some reason
            //             dataManager.addOtherUserEnjRating(
            //                 submission.UserID, submission.User.Name, levelID, submission.Enjoyment
            //             );
            //             numSubmissionsThisLevelRegistered++;
            //             numTotalSubmissionsRegistered++;
            //         }
            //     });
                
            // }

            requestLevelVictors(levelID).then((victorUserIDs) => {
                // ...
            });

            levelsPerEnjoyment[mainUserEnjRating]++;

        } catch (err) {
            if (err.name === "DataError") {
                console.log(`hit ${recs.MAX_OTHER_USERS_TO_TRACK} users`);
                continue;
            }

            if (err.name !== "APIError") {
                throw err;
            }

            if (err.status === 429) {
                // console.log(`halting gathering submissions from level ID ${levelID} due to rate limit`)
            }

        }

        // console.log(`registered ${numSubmissionsThisLevelRegistered} submissions from level ID ${levelID}`);
    }

    console.log(`registered ${numTotalSubmissionsRegistered} submissions from all other users`);
}

async function registerAllOtherUserSubmissions(minTier = DEFAULT_MIN_TIER, maxTier = DEFAULT_MAX_TIER, usersLimit = MAX_OTHER_USERS_TO_COLLECT_FROM, submissionsLimit = MAX_OTHER_USER_SUBMISSIONS, sortMethod = DEFAULT_OTHER_USER_SUBMISSIONS_SORT) {
    // this method won't work unless you've already pre-calculated compats and thresholds before
    const otherUsersArr = [];
    otherUsersArr.push(...dataManager.getMostCompatiblePlayers(usersLimit));

    // use this method if calculating compats and thresholds is to be done later
    // const otherUsersArr = dataManager.getMostCommonPlayers(usersLimit);

    for (const otherUserEnjProfile of otherUsersArr) {
        // console.log(`registering other user submissions from user ID: ${otherUserEnjProfile.userID}`);

        const sortDirection = "desc";

        await registerUserSubmissions(otherUserEnjProfile.userID, otherUserEnjProfile.username, true, minTier - TIER_RANGE_OFFSET,
            maxTier + TIER_RANGE_OFFSET, submissionsLimit, sortMethod, sortDirection
        );
    }

}

export async function getRecommendations(username, minTier = DEFAULT_MIN_TIER, maxTier = DEFAULT_MAX_TIER) {
    // index is the stage
    const timeElapsedPerStage = [];

    if (username === DEBUG_USERNAME) {
        dataManager.useDebugData();

        dataManager.calculateCompatsAndThresholds();
        dataManager.addAllWeights(minTier, maxTier);
        return dataManager.getMostRecommendedLevels();
    }

    // stage 0: collect initial data
    let timestamp = Date.now();
    const userID = await requestUserID(username);

    if (userID == null) {
        throw new Error("User not found! Make sure you have a GDDL account with that name");
    }

    const userProfile = await requestUserProfile(userID);
    if (userProfile.Name != username) {
        console.warn("found user's name does not match input's username");
        // might want to display this to the user
    }

    dataManager.mainUserEnjProfile = new recs.EnjoymentProfile(userID, userProfile.Name, false);
    console.log(`set ${userProfile.Name}'s enj profile as the main enj profile`);
    timeElapsedPerStage.push(Date.now() - timestamp);
    console.log(`STAGE 0 TIME ELAPSED: ${timeElapsedPerStage[0]}ms`);

    // stage 1: registering user submissions
    timestamp = Date.now();
    await registerUserSubmissions(userID, userProfile.name, false); // intentionally leaving out min and max tier to get better user tastes
    timeElapsedPerStage.push(Date.now() - timestamp);
    console.log(`STAGE 1 TIME ELAPSED: ${timeElapsedPerStage[1]}ms`);

    // stage 2: collecting a list of users to analyze until the limit is reached
    timestamp = Date.now();
    await registerAllOtherUserCommonSubmissions();
    timeElapsedPerStage.push(Date.now() - timestamp);
    console.log(`STAGE 2 TIME ELAPSED: ${timeElapsedPerStage[2]}ms`);

    // stage 3: calculating compats
    timestamp = Date.now();
    dataManager.calculateCompatsAndThresholds();
    console.log("calculated compatibilities and thresholds");
    timeElapsedPerStage.push(Date.now() - timestamp);
    console.log(`STAGE 3 TIME ELAPSED: ${timeElapsedPerStage[3]}ms`);

    // stage 4: registering the submissions of the collected users
    timestamp = Date.now();
    await registerAllOtherUserSubmissions(minTier, maxTier);
    console.log("registered all other user submissions");
    timeElapsedPerStage.push(Date.now() - timestamp);
    console.log(`STAGE 4 TIME ELAPSED: ${timeElapsedPerStage[4]}ms`);

    // stage 5: registering all level weights
    timestamp = Date.now();
    dataManager.addAllWeights(minTier, maxTier);
    console.log("added all weights");
    timeElapsedPerStage.push(Date.now() - timestamp);
    console.log(`STAGE 5 TIME ELAPSED: ${timeElapsedPerStage[5]}ms`);

    const totalTimeElapsed = timeElapsedPerStage.reduce(((acc, elem) => acc + elem), 0);
    console.log(`TOTAL TIME ELAPSED: ${totalTimeElapsed}ms`);

    return dataManager.getMostRecommendedLevels();
}

export function resetDataManager() {
    dataManager.reset();
}
