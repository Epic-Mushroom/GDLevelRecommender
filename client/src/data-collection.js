import * as recs from "./recommendations.js";
import {dataManager} from "./recommendations.js"
import {getRandomInt, getNBest, sleep, chunkArray, measureTime, normalize2DArr} from "../../utils.js";

const BACKEND_API_URL = "https://gdlevelrecsdb.onrender.com/api";// db that contains only necessary data for this site
const GDDL_API_URL = "https://gdladder.com/api";
const BACKEND_REDIRECT_URL = "/api"; // redirects to backend
const GDDL_REDIRECT_URL = "/gddlapi"; // redirects to gddl api
const PROXY_URL = `https://corsproxy.io/?${encodeURIComponent(GDDL_API_URL)}`;
const GDDL_PROXY_URL = `/api/gddlproxy`; // redirects to proxy of gddl api hosted on backend, use to make reqs to gddl when 429'd
const PROXIES = [
    GDDL_REDIRECT_URL, // directly access gddl from backend
    GDDL_PROXY_URL
]
const getRandomProxy = () => PROXIES[getRandomInt(0, PROXIES.length - 1)];

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

const DEFAULT_NUM_RECOMMENDATIONS = 9;
const DEFAULT_MAIN_USER_SUBMISSIONS_SORT = "enjoyment";
const DEFAULT_MAIN_USER_SUBMISSIONS_SORT_DIRECTION = "desc";
// UNUSED:
// at max how many of the main user's rated levels per enjoyment rating are sent an api request
// for example if the user has 140 levels rated an 8/10, only [this value] 8/10 levels will be sent a request
// this value is ONLY used when finding users who share levels in common, NOT at the start to get the main user's submissions
const MAX_USER_LEVELS_PER_ENJ_RATING = 5;
// at max how many of the main user's rated levels in total are sent an api request
const MAX_USER_LEVELS_TOTAL = 54;
// at max how many submissions per level to put into dataManager, because getting like 5,000 submissions per level is probably
// a globillion requests total and we don't want that 
const MAX_SUBMISSIONS_TO_TRACK_PER_LEVEL = 90; 
// for sorting when gathering submissions from level page
const DEFAULT_SUBMISSIONS_SORT = "enjoyment";
// up to [this value] users will have their ratings collected
// this is different from recs.MAX_OTHER_USERS_TO_TRACK since not all users will have their ratings collected
const MAX_OTHER_USERS_TO_COLLECT_FROM = 44;
// [this value] is added to max tier and subtracted from min tier when searching for levels from other users' pages
// this is because a user's sent rating is not always the same as the actual rating
const TIER_RANGE_OFFSET = 5;
// up to [this value] levels from other users will be tracked
const MAX_OTHER_USER_SUBMISSIONS = 25;
// for sorting when gathering submissions from other users' pages
const DEFAULT_OTHER_USER_SUBMISSIONS_SORT = "levelRating";
const DEFAULT_OTHER_USER_SUBMISSIONS_SORT_DIRECTION = "desc";

// when requesting batches of ids from backend api
const MAX_LEVEL_ID_BATCH_SIZE = 200;

export const trackers = {
    numAPICalls: 0,
    numAPISuccesses: 0,
    numAPIErrors: 0,

    numRecommendationsSent: 0
}

export const flags = {

};

class Semaphore {
    // max how many api calls to make concurrently
    static MAX_BATCH_REQUEST_SIZE = 20;

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
    const gddlBaseURL = (retried) ? GDDL_PROXY_URL : GDDL_REDIRECT_URL;
    let resultURL = (useGDDL) ? gddlBaseURL : BACKEND_REDIRECT_URL;

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
            console.log("rate limited... waiting 250 ms to retry from proxy");
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
async function requestUserDetails(username) {
    const response = await getAPIResponse(["user", "search"], {limit: 1, name: username}, true);

    if (response.length === 0) {
        return null;

    } else {
        return [response[0].ID, response[0].Name];
    }
}

/**
 * 
 * @param {string} username 
 */
async function requestUsername(userID) {
    // this will make a call to gddl because backend doesn't store usernames
    // not yet at least
    const response = await getAPIResponse(["user", userID], {}, true);

    return (response.Name == null) ? null : response.Name;
}

/**
 * 
 * @param {number} userID 
 * @returns {Array<{l: number, e: number}>}
 */
async function requestUserSubmissions(userID) {
    const response = await getAPIResponse(["user", userID], {});
    const ratingsArr = response.ratings;

    return ratingsArr;
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

export async function requestLevelInfo(levelID) {
    const response = await getAPIResponse(["level", levelID], {});

    return response;
}

export async function requestLevelShowcaseGDDL(levelID) {
    const response = await getAPIResponse(["level", levelID], {}, true);

    return response.Showcase;
}

/**
 * 
 * @param {Array<number>} levelIDs 
 * @returns 
 */
export async function requestLevelInfoBatch(levelIDs) {
    const chunkedArr = chunkArray(levelIDs, MAX_LEVEL_ID_BATCH_SIZE);
    const responseArr = [];

    const promiseArr = [];
    for (const chunk of chunkedArr) {
        promiseArr.push(getAPIResponse(["level"], {
            levelIDs: chunk.join(",")
        }).then((response) => {
            if (chunk.length !== response.length) {
                console.warn(`response length differs from input length by ${chunk.length - response.length}`);
            }

            if (response != null) {
                responseArr.push(...response);
            }
        }));
    }

    await Promise.allSettled(promiseArr);
    return responseArr;
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

async function requestLevelSubmissions(levelID) {
    const response = await getAPIResponse(["level", levelID], {});
    const submissions = response.sub;

    return submissions;
}

async function requestUserSkillsGDDL(userID) {
    const response = await getAPIResponse(["user", userID, "skills"], {
        tierCorrection: "true",
        adjustRarity: "true"
    }, true);

    return response;
}

/**
 * reformats the GDDL API response into a 2D array
 * @param {number} userID 
 * @returns 
 */
export async function getUserSkillsGDDL(userID) {
    try {
        const response = await requestUserSkillsGDDL(userID);

        return Object.entries(response);

    } catch (err) {
        if (err.name === "APIError" && err.status === 429) {
            return [];

        } else {
            throw err;

        }
    }
}

async function requestLevelSkillsGDDL(levelID) {
    const response = await getAPIResponse(["level", levelID, "tags"], {}, true);

    return response;
}

/**
 * reformats the GDDL API response into a 2D array
 * @param {number} levelID
 */
export async function getLevelSkillsGDDL(levelID, limit = null) {
    try {
        const tags = await requestLevelSkillsGDDL(levelID);
        const skillsMap = new Map(); // each skill by id mapped to num of votes

        for (const tag of tags) {
            const skillIDString = SKILLS_MAPPING.get(tag.Tag.Name);
            skillsMap.set(skillIDString, tag.ReactCount);
        }

        if (limit == null) {
            return Array.from(skillsMap);
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

/**
 * 
 * @param {number} levelID 
 * @param {number} limit 
 * @param {Object} APIResponse pass in the object returned by requestLevelInfo (backend's level/levelID endpoint)
 * @returns 
 */
export async function getLevelSkills(levelID, limit = null, APIResponse = null) {
    try {
        const levelInfo = (APIResponse == null) ? await getAPIResponse(["level", levelID], {}) : APIResponse;
        const skillsMap = new Map(); // each skill by id mapped to num of votes

        for (const tag of levelInfo.sk) {
            skillsMap.set(`${tag.tagID}`, tag.count);
        }

        if (limit == null) {
            return Array.from(skillsMap);
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

/**
 * 
 * @param {string} username 
 */
async function registerUserSubmissions(
    userID, username = null, isOther = false, minTier = DEFAULT_MIN_TIER, 
    maxTier = DEFAULT_MAX_TIER, limit = 19999, sortMethod = DEFAULT_MAIN_USER_SUBMISSIONS_SORT,
    sortDirection = DEFAULT_MAIN_USER_SUBMISSIONS_SORT_DIRECTION, skipAcquiringLevelInfo = true
) {
    if (username == null && !isOther /* for now, this should only trigger for main user */) {
        const foundUsername = await requestUsername(userID);  
        username = foundUsername;
    }

    console.log(`attempting to register submissions for ${username}(${userID})`);

    let numSubmissionsRegistered = 0;

    const allRatings = await requestUserSubmissions(userID);
    const promiseArr = allRatings.map(async (rating) => {
        const levelInfo = {
            actualRating: null,
            actualEnj: null,
            levelName: null,
            levelAuthor: null,
            skills2DArr: []
        }

        const savedLevelInfo = dataManager.cachedLevelInfo.get(rating.l);
        if (savedLevelInfo != null) {
            Object.assign(levelInfo, savedLevelInfo);

        }

        if (isOther) {
            const levelInfoResponse = await requestLevelInfo(rating.l);
            const {actualRating: t, actualEnj: e, levelName: n, levelAuthor: a} = levelInfoResponse;
            Object.assign(levelInfo, {t, e, n, a});

            if (isOther) {
                const skills2DArr = await getLevelSkills(rating.l, null, levelInfoResponse);
                levelInfo.skills2DArr = skills2DArr;
            }

            dataManager.addLevelInfoToCache(rating.l, levelInfo);

            dataManager.addOtherUserEnjRating(
                userID, username, rating.l, rating.e, levelInfo
            );

        } else {
            dataManager.addMainUserEnjRating(
                rating.l, rating.e, levelInfo
            );

        }

        numSubmissionsRegistered++;
    });

    await Promise.allSettled(promiseArr);

    console.log(`submission registration for ${username} finished: ${numSubmissionsRegistered} submissions registered`);
}

/**
 * uses gddl api directly to collect a user's submissions
 * @param {string} username 
 */
async function registerUserSubmissionsGDDL(
    userID, username = null, isOther = false, minTier = DEFAULT_MIN_TIER, 
    maxTier = DEFAULT_MAX_TIER, limit = 19999, sortMethod = DEFAULT_MAIN_USER_SUBMISSIONS_SORT,
    sortDirection = DEFAULT_MAIN_USER_SUBMISSIONS_SORT_DIRECTION, registerSkills = true
) {
    // not really needed for other users
    // maybe for potential future "neighbors" feature
    if (username == null && !isOther /* for now, this should only trigger for main user */) {
        const foundUsername = await requestUsername(userID);  
        username = foundUsername;
    }

    console.log(`attempting to register submissions for ${username}(${userID}) using GDDL's api directly`);

    let numSubmissionsRegistered = 0;

    const registration = async (response) => {
        for (const submission of response.submissions) {
            const levelID = submission.Level.ID;
            const levelInfo = {
                actualRating: submission.Level.Rating,
                actualEnj: submission.Level.Enjoyment, 
                levelName: submission.Level.Meta.Name, 
                levelAuthor: submission.Level.Meta.Publisher?.name,
                skills2DArr: []
            };
            const argsData = [
                levelID, submission.Enjoyment, levelInfo
            ]

            if (isOther) {
                // check if level skills already cached, if not register skills here
                // note that this is a blocking operation
                if (registerSkills && !dataManager.cachedLevelInfo.has(levelID) && !dataManager.mainUserEnjProfile.isLevelCompleted(levelID)) {
                    levelInfo.skills2DArr = await getLevelSkills(levelID);
                    // console.log(`obtained skills for ${levelInfo.levelName}`);
                    dataManager.addLevelInfoToCache(levelID, levelInfo, true);

                } else {
                    levelInfo.skills2DArr = dataManager.cachedLevelInfo.get(levelID)?.skills2DArr;

                }

                dataManager.addOtherUserEnjRating(userID, username, ...argsData);

            } else {
                dataManager.addMainUserEnjRating(...argsData);

            }

            numSubmissionsRegistered++;
        }

        // console.log(`${numSubmissionsRegistered} submissions registered for ${username} so far`);
    }

    const registerPage = async (userID, minTier, maxTier, pageNum, sortMethod, sortDirection, isOther) => {
        const response = await requestUserSubmissionsGDDL(userID, minTier, maxTier, pageNum, sortMethod, sortDirection, isOther);
        await registration(response);
    }

    // find the max page first by making a request to the first page
    const response = await requestUserSubmissionsGDDL(userID, minTier, maxTier, 0, sortMethod, sortDirection, isOther);
    await registration(response); // register first page of submissions
    const maxPageNum = Math.ceil(Math.min(response.total, limit) * 1.0 / NUM_SUBMISSIONS_PER_USER_PAGE) - 1;

    const promiseArr = [];
    // starts iterating pages from the other end
    for (let pageNum = 1; pageNum <= maxPageNum; pageNum++) {
        promiseArr.push(registerPage(userID, minTier, maxTier, pageNum, sortMethod, sortDirection, isOther));
    }

    await Promise.allSettled(promiseArr);

    console.log(`submission registration for ${username}(${userID}) finished using GDDL api: ${numSubmissionsRegistered} submissions registered`);
}

async function registerAllOtherUserCommonSubmissions() {
    let numTotalSubmissionsRegistered = 0;
    // index = enjoyment
    const levelsPerEnjoyment = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    console.log("attempting to register all other users' common submissions");

    const promiseArr = [];

    // top MAX_USER_LEVELS_TOTAL levels from the main user sorted by their enjoyment
    const filteredLevelIDs = getNBest(Array.from(dataManager.mainUserEnjProfile.ratingMap.keys()), MAX_USER_LEVELS_TOTAL, (levelID) => {
        return -dataManager.mainUserEnjProfile.ratingMap.get(levelID).enjoyment;
    });

    for (const levelID of filteredLevelIDs) {
        let numSubmissionsThisLevelRegistered = 0;

        const mainUserEnjRating = dataManager.mainUserEnjProfile.getEnjoyment(levelID);

        promiseArr.push(requestLevelInfo(levelID).then((levelInfoResponse) => {
            const submissions2DArr = levelInfoResponse.sub;
            const levelInfo = {
                actualRating: levelInfoResponse.t,
                actualEnj: levelInfoResponse.e,
                levelName: levelInfoResponse.n,
                levelAuthor: levelInfoResponse.a
            };

            // console.log(`trying to register submissions from level ${levelInfo.levelName}`);

            for (const submissionArr of submissions2DArr) {
                if (submissionArr[1] == null) {
                    continue;
                }

                // adds the user to the dataManager if they don't exist yet
                dataManager.addOtherUserEnjRating(
                    submissionArr[0],
                    null,
                    levelID,
                    submissionArr[1],
                    levelInfo
                );

                numTotalSubmissionsRegistered++;
                numSubmissionsThisLevelRegistered++;
            }

            levelsPerEnjoyment[mainUserEnjRating]++;

            // console.log(`registered ${numSubmissionsThisLevelRegistered} submissions from level ${levelInfo.levelName}`);

        }).catch((err) => {
            if (err.name === "DataError") {
                console.log(`hit ${recs.MAX_OTHER_USERS_TO_TRACK} users`);
            }

            if (err.name !== "APIError" && err.name !== "DataError") {
                throw err;
            }

            if (err.status === 429) {
                // console.log(`halting gathering submissions from level ID ${levelID} due to rate limit`)
            }
        }));
    }

    const promiseResults = await Promise.allSettled(promiseArr);

    console.log(`registered ${numTotalSubmissionsRegistered} submissions from all other users`);
}

/**
 * should be called after registerAllOtherUserCommonSubmissions for this to do anything
 * @param {number} minTier 
 * @param {number} maxTier 
 * @param {Array<recs.EnjoymentProfile>} enjProfileArr 
 */
async function registerAllRelevantLevelInfo(minTier = DEFAULT_MIN_TIER, maxTier = DEFAULT_MAX_TIER, enjProfileArr) {
    const megaLevelIDsBatchSet = new Set();

    for (const enjProfile of enjProfileArr) {
        const ratingsArr = await measureTime(
            requestUserSubmissions, [enjProfile.userID], 
            `requesting submissions from ${enjProfile.userID}`
        );

        // filter only the highest enjoyment rating levels from each user
        const filteredRatingsArr = getNBest(ratingsArr, MAX_OTHER_USER_SUBMISSIONS, (ratingInfo) => -ratingInfo.e);

        for (const ratingInfo of filteredRatingsArr) {
            const levelID = ratingInfo.l;
            const savedLevelInfo = dataManager.cachedLevelInfo.get(ratingInfo.l);

            if (savedLevelInfo == null) {
                megaLevelIDsBatchSet.add(levelID);
            }
        }
    }

    const megaLevelIDsBatchArr = Array.from(megaLevelIDsBatchSet);
    console.log(`awaiting registration of ${megaLevelIDsBatchArr.length} levels`);

    const response = await requestLevelInfoBatch(megaLevelIDsBatchArr);

    for (const levelData of response) {
        // INCORPORATE SKILLS HERE
        // .........!!!!!!!!!!!>!<>!<!>!<<!>!<!
        dataManager.addLevelInfoToCache(levelData.levelID, {
            actualRating: levelData.t,
            actualEnj: levelData.e,
            levelName: levelData.n,
            levelAuthor: levelData.a
        });

    }

    console.log(`registered all contender levels`);

}

async function registerAllOtherUserSubmissions(
    minTier = DEFAULT_MIN_TIER, maxTier = DEFAULT_MAX_TIER, usersLimit = MAX_OTHER_USERS_TO_COLLECT_FROM, 
    submissionsLimit = MAX_OTHER_USER_SUBMISSIONS, sortMethod = DEFAULT_OTHER_USER_SUBMISSIONS_SORT
) {
    // this method won't work unless you've already pre-calculated compats and their adjustments before
    // mixes most common players and most compatible players to get a more varied sample
    const otherUsersSet = new Set(dataManager.getMostCommonPlayers(Math.floor(usersLimit * 0.2)));
    const mostCompatible = dataManager.getMostCompatiblePlayers(usersLimit - Math.floor(usersLimit * 0.2));
    mostCompatible.forEach((otherUserProfile) => otherUsersSet.add(otherUserProfile));

    // use this method if calculating compats and adjustments is to be done later
    // const otherUsersArr = dataManager.getMostCommonPlayers(usersLimit);

    const promiseArr = [];
    for (const otherUserEnjProfile of otherUsersSet) {
        // console.log(`registering other user submissions from user ID: ${otherUserEnjProfile.userID}`);

        const sortDirection = "desc";

        // don't use this; it takes WAY too long due to having to register whole profiles into backend
        // which takes way longer than registering a level
        // promiseArr.push(registerUserSubmissions(
        //     otherUserEnjProfile.userID, otherUserEnjProfile.username, true, minTier - TIER_RANGE_OFFSET,
        //     maxTier + TIER_RANGE_OFFSET, submissionsLimit, sortMethod, sortDirection
        // ));

        promiseArr.push(registerUserSubmissionsGDDL(
            otherUserEnjProfile.userID, otherUserEnjProfile.username, true, minTier - TIER_RANGE_OFFSET,
            maxTier + TIER_RANGE_OFFSET, submissionsLimit, sortMethod, sortDirection
        ));
    }

    await Promise.allSettled(promiseArr);

}

export async function getRecommendations(username, minTier = DEFAULT_MIN_TIER, maxTier = DEFAULT_MAX_TIER, skillWeightPref = recs.EnjoymentProfile.SKILL_WEIGHT_PREF.MATCH) {
    // index is the stage
    const timeElapsedPerStage = [];

    // debug purposes only
    if (username === DEBUG_USERNAME) {
        dataManager.useDebugData();

        dataManager.calculateAllCompats();
        dataManager.addAllWeights(minTier, maxTier);


        const levelRecs = dataManager.getMostRecommendedLevels();
        trackers.numRecommendationsSent += levelRecs.length;
        return levelRecs;
    }

    // stage 0: collect initial data
    // should move this to its own function 
    let timestamp = Date.now();
    const userDetails = await requestUserDetails(username);
    if (userDetails == null) {
        throw new Error("User not found! Make sure you have a GDDL account with that name");
    }
    const [userID, foundUsername] = userDetails;

    if (foundUsername !== username) {
        console.warn("found user's name does not match input's username");
        // might want to display this to the user
    }

    dataManager.mainUserEnjProfile = new recs.EnjoymentProfile(userID, foundUsername, false);
    dataManager.mainUserEnjProfile.skillWeightPref = skillWeightPref;
    console.log(`set ${foundUsername}'s enj profile as the main enj profile`);

    getUserSkillsGDDL(userID).then((userSkills) => {
        // PRONE TO RACE CONDITION IF SOMEHOW THIS TAKES UNTIL WEIGHT CALC STAGE TO FINISH
        // THIS VERY LIKELY WON'T HAPPEN THO
        dataManager.mainUserEnjProfile.setSkills(userSkills);
        console.log(`obtained user's skills for ${foundUsername}`);
    });

    timeElapsedPerStage.push(Date.now() - timestamp);
    console.log(`STAGE 0 TIME ELAPSED: ${timeElapsedPerStage[0]}ms`);

    // stage 1: registering user submissions
    // uses the backend db to fetch submissions
    timestamp = Date.now();
    await registerUserSubmissions(userID, foundUsername, false); // intentionally leaving out min and max tier to get better user tastes
    timeElapsedPerStage.push(Date.now() - timestamp);
    console.log(`STAGE 1 TIME ELAPSED: ${timeElapsedPerStage[1]}ms`);

    // stage 2: collecting a list of users to analyze
    timestamp = Date.now();
    await registerAllOtherUserCommonSubmissions();
    timeElapsedPerStage.push(Date.now() - timestamp);
    console.log(`STAGE 2 TIME ELAPSED: ${timeElapsedPerStage[2]}ms`);

    // stage 3: calculating compats
    timestamp = Date.now();
    dataManager.calculateAllCompats();
    console.log("calculated compatibilities and adjustments");
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

    const levelRecs = dataManager.getMostRecommendedLevels(DEFAULT_NUM_RECOMMENDATIONS);
    trackers.numRecommendationsSent += levelRecs.length;
    return levelRecs;
}

export function getNextRecommendation() {
    if (trackers.numRecommendationsSent === 0) {
        return;
    }

    trackers.numRecommendationsSent++;
    return dataManager.getNthMostRecommendedLevel(trackers.numRecommendationsSent);
}

export function resetDataManager() {
    dataManager.reset();
}
