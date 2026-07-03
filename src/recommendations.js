const DEFAULT_USER_ID = 92;
const DEFAULT_USERNAME = "EpicMushroom";

const BASE_COMPAT = 150;
const ENJ_DIFFERENCE_FACTOR = 50;

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

export function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max) + 1;
    return Math.floor(Math.random() * (max - min) + min);
}

export function calculateWeight(enjoyment, compatThreshold) {
    const step1Result = STEP_1_WEIGHT_CALC_B + enjoyment * STEP_1_WEIGHT_CALC_M * 1.0;
    const step2WeightCalcX = (step1Result > 0) ? 0 : 1;
    return step1Result + (-1) ** step2WeightCalcX * STEP_2_WEIGHT_CALC_M * (STEP_2_WEIGHT_CALC_N * compatThreshold) ** STEP_2_WEIGHT_CALC_P + STEP_2_WEIGHT_CALC_B;
}

export class EnjoymentProfile {
    constructor(userID = 92, username = DEFAULT_USERNAME, isOther = false) {
        this.userID = userID;
        this.username = username;
        this.isOther = isOther;

        this.compat = (!isOther) ? BASE_COMPAT : null;
        this.compatThreshold = (!isOther) ? 100.0 : null;

        this.enjMap = new Map();

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
        return this.enjMap.get(levelID);
    }

    addEnjRating(levelID, enjoyment) {
        if (enjoyment < 0 || enjoyment > 10) {
            return null;
        }

        this.enjMap.set(levelID, enjoyment);

        return [levelID, enjoyment];
    }

    clearEnjRatings() {
        this.enjMap.clear();
    }

    isLevelCompleted(levelID) {
        return this.enjMap.has(levelID);
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

        for (const [levelID, enjoyment] of this.enjMap) {
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
         * level ID's of possible recommendations mapped to their calculated weight and number of enj ratings
         * used in the calculation of the weight
         * @type {Map<number, {weight: number, numRatings: number}>}
         */
        this.levelWeightsMap = new Map();
    }

    addMainUserEnjRating(levelID, enjoyment) {
        return this.mainUserEnjProfile.addEnjRating(levelID, enjoyment);
    }

    addOtherUserEnjRating(otherUserID, otherUsername, levelID, enjoyment) {
        if (otherUserID === this.mainUserEnjProfile.userID) {
            return null;
        }

        if (!this.otherUserEnjProfileMap.has(otherUserID)) {
            this.otherUserEnjProfileMap.set(otherUserID, new EnjoymentProfile(otherUserID, otherUsername, true));
        }

        return this.otherUserEnjProfileMap.get(otherUserID).addEnjRating(levelID, enjoyment);
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

    getMostCompatiblePlayers(limit = 10, minRatings = 5) {
        const otherUsersArr = Array.from(this.otherUserEnjProfileMap.values());
        otherUsersArr.sort((a, b) => {
            if (a.calculateCompatThreshold() == null || a.enjMap.size < minRatings) {
                return 1;
            }

            if (b.calculateCompatThreshold() == null || b.enjMap.size < minRatings) {
                return -1;
            }

            return b.calculateCompatThreshold() - a.calculateCompatThreshold();
        });
        otherUsersArr.splice(limit);
        return otherUsersArr;
    }

    getLeastCompatiblePlayers(limit = 10, minRatings = 5) {
        const otherUsersArr = Array.from(this.otherUserEnjProfileMap.values());
        otherUsersArr.sort((a, b) => {
            if (a.calculateCompatThreshold() == null || a.enjMap.size < minRatings) {
                return 1;
            }

            if (b.calculateCompatThreshold() == null || b.enjMap.size < minRatings) {
                return -1;
            }

            return a.calculateCompatThreshold() - b.calculateCompatThreshold();
        });
        otherUsersArr.splice(limit);
        return otherUsersArr;
    }

    addWeight(levelID, weight) {
        if (this.levelWeightsMap.get(levelID) == null) {
            this.levelWeightsMap.set(levelID, {weight: weight, numRatings: 1});

        } else {
            const newWeight = (this.levelWeightsMap.get(levelID).weight * this.levelWeightsMap.get(levelID).numRatings + weight) * (1.0 / (this.levelWeightsMap.get(levelID).numRatings + 1));
            this.levelWeightsMap.set(levelID, {weight: newWeight, numRatings: this.levelWeightsMap.get(levelID).numRatings + 1})

        }

        return weight;
    }

    addAllWeights() {
        for (const otherUserEnjProfile of this.otherUserEnjProfileMap.values()) {
            for (const [levelID, enjRating] of otherUserEnjProfile.enjMap) {
                if (this.mainUserEnjProfile.compatThreshold == null || this.mainUserEnjProfile.isLevelCompleted(levelID)) {
                    continue;
                }

                const calculatedWeight = calculateWeight(enjRating, otherUserEnjProfile.compatThreshold);
                this.addWeight(levelID, calculateWeight);
            }
        }
    }
}

export const dataManager = new DataManager();