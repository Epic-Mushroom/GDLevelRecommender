const DEFAULT_USER_ID = 92;
const DEFAULT_USERNAME = "EpicMushroom";

const BASE_COMPAT = 150;
const ENJ_DIFFERENCE_FACTOR = 50;

export function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max) + 1;
    return Math.floor(Math.random() * (max - min) + min);
}

export class EnjoymentProfile {
    constructor(userID = 92, username = DEFAULT_USERNAME, isOther = false) {
        this.userID = userID;
        this.username = username;
        this.isOther = isOther;

        this.compat = (!isOther) ? BASE_COMPAT : null;
        this.compatThreshold = (!isOther) ? 100.0 : null;

        this.enjMap = new Map();
    }

    setUsername(username) {
        this.username = username;
    }

    setUserID(ID) {
        this.userID = ID;
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
    getCompatThreshold() {
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
                this.compatThreshold = (100.0 * i) / dataManager.compatArr.length;
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

    calculateCompats() {
        this.compatArr = [];

        for (const otherUserEnjProfile of this.otherUserEnjProfileMap.values()) {
            this.compatArr.push(otherUserEnjProfile.calculateCompat());
        }

        this.compatArr.sort((a, b) => a - b);
    }
}

export const dataManager = new DataManager();