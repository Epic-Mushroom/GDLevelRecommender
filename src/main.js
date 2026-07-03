import * as recs from "./recommendations.js";
import {dataManager, getRandomInt} from "./recommendations.js"

const GDDL_API_URL = "https://gdladder.com/api";
const PROXY_URL_1 = `https://corsproxy.io/?${encodeURIComponent(GDDL_API_URL)}`;

const RATE_LIMIT_DELAY_MS = 0;

const NUM_SUBMISSIONS_PER_USER_PAGE = 25;
const NUM_SUBMISSIONS_PER_LEVEL_PAGE = 30;

const DEFAULT_MIN_TIER = 1;
const DEFAULT_MAX_TIER = 39;

// at max how many of the main user's rated levels per enjoyment rating are sent an api request
// for example if the user has 140 levels rated an 8/10 only [this value] levels will be sent a request
// this value is ONLY used when finding users who share levels in common, NOT at the start to get the main user's submissions
const MAX_USER_LEVELS_PER_ENJ_RATING = 10;
// at max how many submissions per level to put into dataManager, because getting like 5,000 submissions per level is probably
// a globillion requests total and we don't want that 
const MAX_SUBMISSIONS_TO_TRACK_PER_LEVEL = 120; 
// for sorting when gathering submissions from level page
const DEFAULT_SUBMISSIONS_SORT = "dateAdded";
const DEFAULT_SUBMISSIONS_SORT_DIRECTION = "asc";
// up to [this value] users will have their ratings collected
const MAX_OTHER_USERS_TO_COLLECT_FROM = 12;
// up to [this value] levels from other users will be tracked
const MAX_OTHER_USER_SUBMISSIONS = 50;
// for sorting when gathering submissions from other users' pages
const DEFAULT_OTHER_USER_SUBMISSIONS_SORT = "recency";
const DEFAULT_OTHER_USER_SUBMISSIONS_SORT_DIRECTION = "desc";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
 * @param {string} message 
 */
function errorMsg(errorMessageText, message) {
    errorMessageText.textContent = message;
}

/**
 * 
 * @param {Array<string>} pathVariables 
 * @param {Object} queryParams 
 */
async function getAPIResponse(pathVariables, queryParams, retried = false) {
    let resultURL = GDDL_API_URL;

    for (const variable of pathVariables) {
        resultURL += `/${encodeURIComponent(variable)}`;
    }

    const query = new URLSearchParams(queryParams).toString();
    if (query.length > 0) {
        resultURL += `?${query}`;
    }

    const response = await fetch(resultURL);

    if (!response.ok) {
        const contentType = response.headers.get("content-type");

        // if (response.status === 429 && !retried) {
        //     console.log("rate limited... waiting 0 seconds");
        //     await sleep(RATE_LIMIT_DELAY_MS);
        //     return await getAPIResponse(pathVariables, queryParams, true);
        // }

        if (contentType && contentType.includes("application/json")) {
            throw new APIError(response.status, `${response.status}: ${(await response.json()).message}`);

        } else {
            throw new APIError(response.status, `${response.status}: ${await response.text()}`);

        }
    }

    return await response.json();
}

/**
 * 
 * @param {string} username 
 */
async function getUserID(username) {
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
async function getUserProfile(userID) {
    const response = await getAPIResponse(["user", userID], {});

    return response;
}

async function getLevelSubmissions(levelID, pageNum) {
    const response = await getAPIResponse(["level", levelID, "submissions"], {
        sort: DEFAULT_SUBMISSIONS_SORT,
        sortDirection: DEFAULT_SUBMISSIONS_SORT_DIRECTION,
        twoPlayer: false,
        progressFilter: "victors",
        limit: NUM_SUBMISSIONS_PER_LEVEL_PAGE,
        page: pageNum
    });

    return response;
}

/**
 * 
 * @param {string} username 
 */
async function registerUserSubmissions(userID, username = null, isOther = false, minTier = DEFAULT_MIN_TIER, maxTier = DEFAULT_MAX_TIER, limit = 19999, sortMethod = "levelRating") {
    if (username == null) {
        const userProfile = await getUserProfile(userID);  
        username = userProfile.Name;
    }

    console.log(`attempting to register submissions for ${username}`);

    let numSubmissionsRegistered = 0;

    for (let pageNum = 0; pageNum < 999; pageNum++) {
        let limitReached = false;

        const response = await getAPIResponse(["user", userID, "submissions"], {
            minTier: minTier,
            maxTier: maxTier,
            limit: NUM_SUBMISSIONS_PER_USER_PAGE,
            page: pageNum,
            sort: sortMethod,
            sortDirection: "desc",
            onlyIncomplete: false,
            pending: false
        });

        if (response.submissions == null || response.submissions.length === 0) {
            break;
        }

        for (const submission of response.submissions) {
            if (isOther) {
                dataManager.addOtherUserEnjRating(userID, username, submission.Level.ID, submission.Enjoyment);

            } else {
                dataManager.addMainUserEnjRating(submission.Level.ID, submission.Enjoyment);

            }

            numSubmissionsRegistered++;
            if (numSubmissionsRegistered >= limit) {
                limitReached = true;
                break;
            }
        }

        if (limitReached) {
            break;
        }

        // console.log(`${numSubmissionsRegistered} submissions registered so far`);
    }

    console.log(`submission registration for ${username} finished: ${numSubmissionsRegistered} submissions registered`);
}

async function registerAllOtherUserCommonSubmissions() {
    let numTotalSubmissionsRegistered = 0;
    const ratingsPerEnjoyment = new Map(Object.entries({
        0: 0,
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0,
        7: 0,
        8: 0,
        9: 0,
        10: 0
    }));

    console.log("attempting to register all other users' common submissions");

    for (const levelID of dataManager.mainUserEnjProfile.enjMap.keys()) {
        let numSubmissionsThisLevelRegistered = 0;

        try {
            const mainUserEnjRating = dataManager.mainUserEnjProfile.getEnjoyment(levelID);

            if (mainUserEnjRating == null || ratingsPerEnjoyment.get(mainUserEnjRating) >= MAX_USER_LEVELS_PER_ENJ_RATING) {
                // console.log(`skipping getting other user submissions from level ID ${levelID}`);
                continue;
            }

            for (let pageNum = 0; pageNum < Math.ceil(MAX_SUBMISSIONS_TO_TRACK_PER_LEVEL * 1.0 / NUM_SUBMISSIONS_PER_LEVEL_PAGE); pageNum++) {
                const response = await getLevelSubmissions(levelID, pageNum);

                for (const submission of response.submissions) {
                    if (submission.Enjoyment == null) {
                        continue;
                    }

                    dataManager.addOtherUserEnjRating(submission.UserID, submission.User.Name, levelID, submission.Enjoyment);
                    numSubmissionsThisLevelRegistered++;
                    numTotalSubmissionsRegistered++;
                }
            }

            ratingsPerEnjoyment.set(mainUserEnjRating, ratingsPerEnjoyment.get(mainUserEnjRating) + 1);

        } catch (err) {
            if (err.name != "APIError") {
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
    const otherUsersArr = [];
    otherUsersArr.push(...dataManager.getLeastCompatiblePlayers(usersLimit / 2));
    otherUsersArr.push(...dataManager.getMostCompatiblePlayers(usersLimit - usersLimit / 2));
    
    const promiseArr = [];

    for (const otherUserEnjProfile of otherUsersArr) {
        console.log(`registering other user submissions from user ID: ${otherUserEnjProfile.userID}`);
        promiseArr.push(registerUserSubmissions(otherUserEnjProfile.userID, otherUserEnjProfile.username, true, minTier, maxTier, submissionsLimit, sortMethod));
    }

    await Promise.all(promiseArr);
}

async function getRecommendations(username, minTier = DEFAULT_MIN_TIER, maxTier = DEFAULT_MAX_TIER) {
    try {
        const userID = await getUserID(username);

        if (userID == null) {
            throw new Error("User not found!");
        }

        const userProfile = await getUserProfile(userID);
        if (userProfile.Name != username) {
            console.warn("found user's name does not match input's username");
            // might want to display this to the user
        }

        dataManager.mainUserEnjProfile = new recs.EnjoymentProfile(userID, userProfile.Name, false);
        console.log(`set ${userProfile.Name}'s enj profile as the main enj profile`);

        await registerUserSubmissions(userID, userProfile.name, false, minTier, maxTier);

        await registerAllOtherUserCommonSubmissions();
        dataManager.calculateCompatsAndThresholds();
        console.log("calculated compatibilities and thresholds");

        await registerAllOtherUserSubmissions(minTier, maxTier);
        console.log("registered all other user submissions");

        dataManager.addAllWeights();
        console.log("added all weights...?");

    } catch (err) {
        errorMsg(errorMessageText, err.message);

    }
}

// elements
const form = document.getElementById("form");
const submitButton = document.getElementById("submit-button");
const usernameField = document.getElementById("username-field");

const errorMessageText = document.getElementById("error-message-text");

// element listeners
form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);

    if (formData.get("username") === "") {
        errorMsg(errorMessageText, "Username can't be blank");
        return;
    }

    dataManager.reset();

    await getRecommendations(formData.get("username"));
});
