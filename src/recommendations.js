import {getRandomInt, getNSmallest} from "./utils.js";

const DEFAULT_USER_ID = 92;
const DEFAULT_USERNAME = "EpicMushroom";

const BASE_COMPAT = 150;
const ENJ_DIFFERENCE_FACTOR = 50;

// up to [this value] users will be put into the database
export const MAX_OTHER_USERS_TO_TRACK = 1999;

// step 1 weight calc formula: B + enjoyment * M
const STEP_1_WEIGHT_CALC_B = -500;
const STEP_1_WEIGHT_CALC_M = 100;
// step 2 weight calc formula: (-1)^X * M * (N * compatThreshold)^P + B
// X = 0 if step 1's weight > 0, X = 1 otherwise
// add both steps
// basically, 
// if other user likes a level, and high compatibility, increase the weight
// if other user doesn't like a level, and high compat, decrease the weight
// if other user likes a level, and low compat, decrease the weight
// if other user doesn't like a level, and low compat, increase the weight
const STEP_2_WEIGHT_CALC_M = 1.3;
const STEP_2_WEIGHT_CALC_N = 1.5;
const STEP_2_WEIGHT_CALC_P = 1.2;
const STEP_2_WEIGHT_CALC_B = -260;

/**
 * 
 * @param {number} enjoyment 
 * @param {number} rating 
 * @param {number} maxTier 
 * @param {number} minTier 
 * @param {number} compatThreshold 
 * @returns 
 */
export function calculateWeight(enjoyment, rating, minTier, maxTier, compatThreshold) {
    const step1Result = STEP_1_WEIGHT_CALC_B + enjoyment * STEP_1_WEIGHT_CALC_M * 1.0;
    const step2WeightCalcX = (step1Result > 0) ? 0 : 1;
    let cumulativeResult = step1Result + (-1) ** step2WeightCalcX * STEP_2_WEIGHT_CALC_M * (STEP_2_WEIGHT_CALC_N * compatThreshold) ** STEP_2_WEIGHT_CALC_P + STEP_2_WEIGHT_CALC_B;

    if (rating < minTier || rating > maxTier) {
        cumulativeResult -= 99999;
    }

    // skill weighting here

    return cumulativeResult;
}

class DataError extends Error {
    constructor(message) {
        super(message);
        
        this.name = "DataError";
    }
}

export class EnjoymentProfile {
    constructor(userID = DEFAULT_USER_ID, username = DEFAULT_USERNAME, isOther = false) {
        this.userID = userID;
        this.username = username;
        this.isOther = isOther;

        this.compat = (!isOther) ? BASE_COMPAT : null;
        this.compatThreshold = (!isOther) ? 100.0 : null;

        /**
         * level ID's mapped to the user's rated enjoyment and the level's info
         * @type {Map<number, {enjoyment: number, actualRating: number, actualEnj: number, levelName: string, levelAuthor: string}>}
         */
        this.ratingMap = new Map();

        this.numCommonLevels = 0;

        this.leastFavoriteLevelIDs = [];
        this.favoriteLevelIDs = [];
    }

    setUsername(username) {
        this.username = username;
    }

    setUserID(ID) {
        this.userID = ID;
    }

    addLeastFavorite(levelID) {
        this.leastFavoriteLevelIDs.push(levelID);
    }

    addFavorite(levelID) {
        this.favoriteLevelIDs.push(levelID);
    }

    getEnjoyment(levelID) {
        return this.ratingMap.get(levelID)?.enjoyment;
    }

    addEnjRating(levelID, enjoyment, actualRating, actualEnj = -1, levelName = "Level", levelAuthor = "-") {
        if (enjoyment < 0 || enjoyment > 10) {
            return null;
        }

        this.ratingMap.set(levelID, {enjoyment: enjoyment, actualRating: actualRating, actualEnj: actualEnj, levelName: levelName, levelAuthor: levelAuthor});

        if (!this.isOther || dataManager.mainUserEnjProfile.getEnjoyment(levelID) != null) {
            this.numCommonLevels++;
        }

        return [levelID, enjoyment];
    }

    clearEnjRatings() {
        this.ratingMap.clear();
    }

    isLevelCompleted(levelID) {
        return this.ratingMap.has(levelID);
    }

    calculateCompat() {
        if (this.compat != null) {
            return this.compat;
        }

        if (!this.isOther) {
            this.compat = BASE_COMPAT;
            return BASE_COMPAT;
        }

        let totalCompat = 0;
        let numCommonLevels = 0;

        for (const [levelID, ratingInfo] of this.ratingMap) {
            const enjoyment = ratingInfo.enjoyment;
            const mainUserEnjoyment = dataManager.mainUserEnjProfile.getEnjoyment(levelID);

            if (mainUserEnjoyment == null) {
                continue;
            }

            const enjDifference = Math.abs(enjoyment - mainUserEnjoyment);

            totalCompat += BASE_COMPAT - ENJ_DIFFERENCE_FACTOR * enjDifference;
            numCommonLevels++;
        }

        if (numCommonLevels === 0) {
            // can't determine compat if there are no levels in common
            return null;
        }

        this.compat = totalCompat * 1.0 / numCommonLevels;
        return this.compat;
    }

    // returns a percentile relating to how much this user is compatible with the main user's enjoyments
    // higher percentile = more useful
    calculateCompatThreshold() {
        if (this.compatThreshold != null) {
            return this.compatThreshold;
        }

        this.compat = this.calculateCompat();
        
        if (this.compat == null) {
            // should only rarely be the case (happens if there are no levels in common)
            this.compatThreshold = null;
            return null;
        }

        if (dataManager.compatArr.length === 0) {
            return 0;
        }

        // assumes all compats are already sorted in ascending order
        for (let i = 0; i < dataManager.compatArr.length; i++) {
            const compatValue = dataManager.compatArr[i];
            if (compatValue != null && compatValue >= this.compat) {
                return this.compatThreshold = (100.0 * i) / dataManager.compatArr.length;
            }

        }

        return this.compatThreshold;
    }
}

class DataManager {
    constructor() {
        this.reset();
    }

    reset() {
        this.mainUserEnjProfile = new EnjoymentProfile();
        /**
         * other users' IDs' each mapped to their own enjoyment profiles
         * @type {Map<number, EnjoymentProfile>}
         */
        this.otherUserEnjProfileMap = new Map();
        // just contains the compatibility values of all collected players, used to calculate compat threshold
        this.compatArr = [];
        /**
         * level ID's of possible recommendations mapped to their calculated weight, number of enj ratings
         * used in the calculation of the weight, and level info
         * @type {Map<number, {weight: number, numRatings: number, levelInfo: {actualRating: number, actualEnj: number, levelName: string}}>}
         */
        this.levelWeightsMap = new Map();
    }

    addMainUserEnjRating(levelID, enjoyment, actualRating, actualEnj, levelName) {
        return this.mainUserEnjProfile.addEnjRating(levelID, enjoyment, actualRating, actualEnj, levelName);
    }

    addOtherUserEnjRating(otherUserID, otherUsername, levelID, enjoyment, actualRating, actualEnj, levelName) {
        if (otherUserID === this.mainUserEnjProfile.userID) {
            return null;
        }

        if (!this.otherUserEnjProfileMap.has(otherUserID)) {
            if (this.otherUserEnjProfileMap.size >= MAX_OTHER_USERS_TO_TRACK) {
                throw new DataError("other user enj profile map is full");
            }

            this.otherUserEnjProfileMap.set(otherUserID, new EnjoymentProfile(otherUserID, otherUsername, true));
        }

        return this.otherUserEnjProfileMap.get(otherUserID).addEnjRating(levelID, enjoyment, actualRating, actualEnj, levelName);
    }

    calculateCompatsAndThresholds() {
        this.compatArr = [];

        for (const otherUserEnjProfile of this.otherUserEnjProfileMap.values()) {
            this.compatArr.push(otherUserEnjProfile.calculateCompat());
        }

        this.compatArr.sort((a, b) => a - b);

        for (const otherUserEnjProfile of this.otherUserEnjProfileMap.values()) {
            otherUserEnjProfile.calculateCompatThreshold();
        }
    }

    /**
     * returns the players with the most number of levels completed in common, not to be confused with highest compatibility
     * @param {number} limit 
     */
    getMostCommonPlayers(limit) {
        return getNSmallest(this.otherUserEnjProfileMap.values(), limit, (a) => {
            return -1 * a.numCommonLevels;
        });
    }

    getMostCompatiblePlayers(limit = 10, minRatings = 1) {
        return getNSmallest(this.otherUserEnjProfileMap.values(), limit, (a) => {
            if (a.compatThreshold == null || a.ratingMap.size < minRatings) {
                return Infinity;
            }

            return -1 * a.compatThreshold;
        });
    }

    getLeastCompatiblePlayers(limit = 10, minRatings = 1) {
        return getNSmallest(this.otherUserEnjProfileMap.values(), limit, (a) => {
            if (a.compatThreshold == null || a.ratingMap.size < minRatings) {
                return Infinity;
            }

            return a.compatThreshold;
        });
    }

    addWeight(levelID, weight, levelInfo) {
        if (this.levelWeightsMap.get(levelID) == null) {
            this.levelWeightsMap.set(levelID, {weight: weight, numRatings: 1, levelInfo: levelInfo});

        } else {
            const newWeight = (this.levelWeightsMap.get(levelID).weight * this.levelWeightsMap.get(levelID).numRatings + weight) * (1.0 / (this.levelWeightsMap.get(levelID).numRatings + 1));
            this.levelWeightsMap.set(levelID, {weight: newWeight, numRatings: this.levelWeightsMap.get(levelID).numRatings + 1, levelInfo: levelInfo})

        }

        return weight;
    }

    addAllWeights(minTier = 1, maxTier = 39) {
        for (const otherUserEnjProfile of this.otherUserEnjProfileMap.values()) {
            for (const [levelID, ratingInfo] of otherUserEnjProfile.ratingMap) {
                if (this.mainUserEnjProfile.compatThreshold == null || this.mainUserEnjProfile.isLevelCompleted(levelID)) {
                    continue;
                }

                const enjRating = ratingInfo.enjoyment;
                const actualRating = ratingInfo.actualRating;
                const calculatedWeight = calculateWeight(enjRating, actualRating, minTier, maxTier, otherUserEnjProfile.compatThreshold);
                this.addWeight(levelID, calculatedWeight, {actualRating: actualRating, actualEnj: ratingInfo.actualEnj, levelName: ratingInfo.levelName});
            }
        }
    }

    getMostRecommendedLevels(limit = 10, minTier, maxTier) {
        return getNSmallest(this.levelWeightsMap, limit, ([key, val]) => {
            return -this.levelWeightsMap.get(key).weight;
        })
    }

    useDebugData() {
        dataManager.reset();

        dataManager.mainUserEnjProfile.setUserID(92);
        dataManager.mainUserEnjProfile.setUsername("diffieHellmanSpongebob93229"); 

        dataManager.addMainUserEnjRating(1, 3, 3);
        dataManager.addMainUserEnjRating(2, 3, 3);
        dataManager.addMainUserEnjRating(3, 9, 5);

        dataManager.addOtherUserEnjRating(666666, "IncompatibleGuy", 1, 10, 3); 
        dataManager.addOtherUserEnjRating(666666, "IncompatibleGuy", 2, 10, 3); 
        dataManager.addOtherUserEnjRating(666666, "IncompatibleGuy", 3, 1, 5); 
        dataManager.addOtherUserEnjRating(666666, "IncompatibleGuy", 37456092, 10, 28, 6, "Digital Descent"); // Digital Descent
        dataManager.addOtherUserEnjRating(666666, "IncompatibleGuy", 62214792, 10, 21); // Azurite sillow
        dataManager.addOtherUserEnjRating(666666, "IncompatibleGuy", 42566186, 10, 5); // Lazurite
        dataManager.addOtherUserEnjRating(666666, "IncompatibleGuy", 59533451, 10, 24); // Azurite royen

        dataManager.addOtherUserEnjRating(676767, "CompatibleGamer727", 1, 2, 3);
        dataManager.addOtherUserEnjRating(676767, "CompatibleGamer727", 2, 2, 3);
        dataManager.addOtherUserEnjRating(676767, "CompatibleGamer727", 3, 8, 5);
        dataManager.addOtherUserEnjRating(676767, "CompatibleGamer727", 37456092, 3, 28, 6, "Digital Descent"); // Digital Descent
        dataManager.addOtherUserEnjRating(676767, "CompatibleGamer727", 62214792, 5, 21); // Azurite sillow
        dataManager.addOtherUserEnjRating(676767, "CompatibleGamer727", 91739197, 10, 24); // Heavens Door
        dataManager.addOtherUserEnjRating(676767, "CompatibleGamer727", 58252259, 9, 28); // Ethereal Artifice
        dataManager.addOtherUserEnjRating(676767, "CompatibleGamer727", 132898839, 10, 30); // Next Stage
        dataManager.addOtherUserEnjRating(676767, "CompatibleGamer727", 62869408, 7, 29); // Chromatic Haze
    }
}

export const dataManager = new DataManager();
window.dataManager = dataManager;