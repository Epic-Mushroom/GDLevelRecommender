import {
    getRandomInt, getNBest, pearsonSimilarity, normalize2DArr, 
    adjustToRange, invert2DArr, cosineSimilarity, scoreVector,
    getNthBest
} from "../../utils.js";

const DEFAULT_USER_ID = 92;
const DEFAULT_USERNAME = "EpicMushroom";

// up to [this value] users will be put into the database
export const MAX_OTHER_USERS_TO_TRACK = 39999;

const BASE_COMPAT = 150;
const ENJ_DIFFERENCE_FACTOR = 50;
// multiplies the compat value if a certain number of levels are in common
// this is to prevent people who have 1 level in common getting a very high compat
const HIGH_NUM_COMMON_LEVELS_MULTIPLIER = 2.8;
const MIN_NUM_COMMON_LEVELS_FOR_MULTIPLIER = 5;
const MAX_COMPAT = BASE_COMPAT * HIGH_NUM_COMMON_LEVELS_MULTIPLIER;

// OLD step 1 weight calc formula: B + enjoyment * M
//
// NEW step 1 weight calc formula: (enjoyment^2 * A) + B2
// so that high enjoyments (8-10) are weighted more heavily than 5 or 6
const STEP_1_WEIGHT_CALC_B = -500;
const STEP_1_WEIGHT_CALC_M = 100;
const STEP_1_WEIGHT_CALC_A = 5;
const STEP_1_WEIGHT_CALC_B2 = 0;
// OLD step 2 weight calc formula: (-1)^X * M * (N * adjustedCompat)^P + B
// X = 0 if step 1's weight > 0, X = 1 otherwise
// add step 2 to step 1
// basically, 
// if other user likes a level, and high compatibility, increase the weight
// if other user doesn't like a level, and high compat, decrease the weight
// if other user likes a level, and low compat, decrease the weight
// if other user doesn't like a level, and low compat, increase the weight <=== THIS WAS NOT A GOOD IDEA
//
// NEW step 2 weight calc formula: (adjustedCompat / 100)^P2
// MULTIPLY step 2 with step 1
const STEP_2_WEIGHT_CALC_M = 1.3;
const STEP_2_WEIGHT_CALC_N = 1.5;
const STEP_2_WEIGHT_CALC_P = 1.2;
const STEP_2_WEIGHT_CALC_B = -260;
const STEP_2_WEIGHT_CALC_P2 = 2.0;
// for skill weighting
const SKILL_VECTOR_NORMALIZATION_MAGNITUDE = 100.0;
// if the user's skillset perfectly aligns with a level, this is the final multiplier to the weight
const MAX_SKILL_MATCH_MULTIPLIER = 1.6;
// and this is the opposite
const MAX_SKILL_CONTRAST_MULTIPLIER = 0.27;
// multiplies this with perfect match multiplier and multiplies the reciprocal with perfect contrast multiplier
// when trying to aggressively fit skills
const SKILL_FIT_AGGRESSION_MULTIPLIER = 2.2;
const NUM_USER_SKILLS_TO_SCORE = null;
const NUM_LEVEL_SKILLS_TO_SCORE = 3;
// for use in modified average weight
const STEP_3_WEIGHT_CONSTANT = 2.0;
const STEP_3_WEIGHT_CALC_B = 0.6174;
const STEP_3_WEIGHT_CALC_A = 0.2377;
const STEP_3_WEIGHT_CALC_A2 = 0.588235294;

/**
 * 
 * @param {[string, number][]} levelSkills 
 * @param {EnjoymentProfile} mainUserProfile 
 * @returns 
 */
function calculateSkillMultiplier(levelSkills, mainUserProfile) {
    // if the level has no votes on skills, it shouldn't count for or against the weight regardless
    if (levelSkills.length === 0) {
        return 1.0;
    }

    const skillWeightPref = mainUserProfile?.skillWeightPref;
    let modifiedUserSkills = [];
    let modifiedLevelSkills = normalize2DArr(levelSkills, SKILL_VECTOR_NORMALIZATION_MAGNITUDE);
    switch (skillWeightPref) {
        case EnjoymentProfile.SKILL_WEIGHT_PREF.NONE:
            break;

        case EnjoymentProfile.SKILL_WEIGHT_PREF.MATCH:
            modifiedUserSkills = normalize2DArr(mainUserProfile?.skills2DArr, SKILL_VECTOR_NORMALIZATION_MAGNITUDE);
            break;

        case EnjoymentProfile.SKILL_WEIGHT_PREF.OPPOSITE:
            modifiedUserSkills = normalize2DArr(mainUserProfile?.skills2DArr, SKILL_VECTOR_NORMALIZATION_MAGNITUDE);
            break;

        case EnjoymentProfile.SKILL_WEIGHT_PREF.LIKE:
            modifiedUserSkills = normalize2DArr(mainUserProfile?.calculateLikedSkills(), SKILL_VECTOR_NORMALIZATION_MAGNITUDE);
            break;

        default:
            break;
    }

    let skillMultiplier = 1.0;
    if (skillWeightPref !== EnjoymentProfile.SKILL_WEIGHT_PREF.NONE) {
        // const cosineSim = cosineSimilarity(modifiedUserSkills, modifiedLevelSkills, SKILL_VECTOR_NORMALIZATION_MAGNITUDE, SKILL_VECTOR_NORMALIZATION_MAGNITUDE);
        const userSkillsScore = scoreVector(modifiedUserSkills, modifiedLevelSkills, NUM_USER_SKILLS_TO_SCORE, NUM_LEVEL_SKILLS_TO_SCORE);

        const maxMultiplier = ((mainUserProfile.skillWeightAggression) ?
            (MAX_SKILL_MATCH_MULTIPLIER * SKILL_FIT_AGGRESSION_MULTIPLIER) : MAX_SKILL_MATCH_MULTIPLIER
        );
        const minMultiplier = ((mainUserProfile.skillWeightAggression) ?
            (MAX_SKILL_CONTRAST_MULTIPLIER / SKILL_FIT_AGGRESSION_MULTIPLIER) : MAX_SKILL_CONTRAST_MULTIPLIER
        );

        if (skillWeightPref !== EnjoymentProfile.SKILL_WEIGHT_PREF.OPPOSITE) {
            if (userSkillsScore <= 0.5) {
                skillMultiplier = adjustToRange(userSkillsScore, [0, 0.5], [minMultiplier, 1.0]);
            } else {
                skillMultiplier = adjustToRange(userSkillsScore, [0.5, 1], [1.0, maxMultiplier]);
            }

        } else {
            if (userSkillsScore <= 0.5) {
                skillMultiplier = adjustToRange(userSkillsScore, [0, 0.5], [maxMultiplier, 1.0]);
            } else {
                skillMultiplier = adjustToRange(userSkillsScore, [0.5, 1], [1.0, minMultiplier]);
            }

        }

    }

    return skillMultiplier;
}

/**
 * 
 * @param {number} enjoyment 
 * @param {number} rating 
 * @param {[string, number][]} levelSkills
 * @param {number} maxTier 
 * @param {number} minTier 
 * @param {number} adjustedCompat 
 * @param {EnjoymentProfile} mainUserProfile
 * @returns 
 */
export function calculateWeight(enjoyment, rating, levelSkills, minTier, maxTier, adjustedCompat, mainUserProfile) {
    // old formula (very complex and honestly not even good)
    // const step1Result = STEP_1_WEIGHT_CALC_B + enjoyment * STEP_1_WEIGHT_CALC_M * 1.0;
    // const step2WeightCalcX = (step1Result > 0) ? 0 : 1;
    // let cumulativeResult = step1Result + (-1) ** step2WeightCalcX * STEP_2_WEIGHT_CALC_M * (STEP_2_WEIGHT_CALC_N * adjustedCompat) ** STEP_2_WEIGHT_CALC_P + STEP_2_WEIGHT_CALC_B;

    // new formula
    let cumulativeResult = 0;
    const step1Result = STEP_1_WEIGHT_CALC_A * (enjoyment ** 2) + STEP_1_WEIGHT_CALC_B2;
    const compatMultiplier = (adjustedCompat / 100.0) ** STEP_2_WEIGHT_CALC_P2;
    cumulativeResult += step1Result * compatMultiplier

    // skill weighting here
    const skillMultiplier = calculateSkillMultiplier(levelSkills, mainUserProfile);
    const skillWeight = ((skillMultiplier - 1) * cumulativeResult);
    cumulativeResult += skillWeight;
    // console.log(`   applied a skill multiplier of ${skillMultiplier} (+${skillWeight}) to this level (${cumulativeResult - skillWeight} -> ${cumulativeResult})`);

    if (Math.round(rating) < minTier || Math.round(rating) > maxTier) {
        cumulativeResult *= 1.0 / 999;
    }

    return {totalWeight: cumulativeResult, skillMultiplier: skillMultiplier};
}

class DataError extends Error {
    constructor(message) {
        super(message);
        
        this.name = "DataError";
    }
}

export class EnjoymentProfile {
    // modifies how the main user's skillset affects weighting
    static SKILL_WEIGHT_PREF = Object.freeze({
        NONE: "NONE", // skills are not taken into account
        MATCH: "MATCH", // tries to weight levels that match user's skillset
        OPPOSITE: "OPPOSITE", // tries to weight levels that contrast user's skillset
        LIKE: "LIKE" // tries to determine the skills the user likes, and matches those (not going to implement for a while)
    });

    constructor(userID = DEFAULT_USER_ID, username = DEFAULT_USERNAME, isOther = false) {
        this.userID = userID;
        this.username = username;
        this.isOther = isOther;

        this.avgEnjoyment = null;

        this.compat = (!isOther) ? BASE_COMPAT : null;
        this.adjustedCompat = (!isOther) ? 100.0 : null;

        /**
         * level ID's mapped to the user's rated enjoyment and the level's info
         * @type {Map<number, {enjoyment: number, actualRating: number, actualEnj: number, levelName: string, levelAuthor: string, skills2DArr: [string, number][]}>}
         */
        this.ratingMap = new Map();

        this.numCommonLevels = 0;

        this.leastFavoriteLevelIDs = [];
        this.favoriteLevelIDs = [];

        this.skills2DArr = [];
        this.likedSkills2DArr = [];
        this.skillWeightPref = EnjoymentProfile.SKILL_WEIGHT_PREF.MATCH;
        this.skillWeightAggression = false;
    }

    setSkills(skills2DArr) {
        if (this.isOther) {
            // don't need skills of users other than main one
            return;
        }

        this.skills2DArr = skills2DArr;
    }

    /**
     * 
     * @param {string} pref 
     */
    setSkillWeightPref(pref) {
        this.skillWeightPref = pref;
    }

    /**
     * 
     * @returns {[string, number][]}
     */
    calculateLikedSkills() {
        if (this.likedSkills2DArr.length > 0) {
            return this.likedSkills2DArr;
        }

        // ...

        this.likedSkills2DArr = this.skills2DArr;
        return this.likedSkills2DArr;
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

    /**
     * returns a modified enjoyment value with respect to the main user's avg enjoyment
     * for example, if this user's avg enj is 8.0, and the main user's is 6.7, will subtract 1.3 from the rawEnj
     * @param {number} rawEnj
     * @param {EnjoymentProfile} mainUserProfile
     */
    getAdjustedEnjoyment(rawEnj, mainUserProfile) {
        const mainUserAvgEnj = mainUserProfile.getAvgEnjoyment();
        const thisUserAvgEnj = this.getAvgEnjoyment();
        const difference = mainUserAvgEnj - thisUserAvgEnj;

        return rawEnj + difference;
    }

    getAvgEnjoyment() {
        if (this.avgEnjoyment == null) {
            const allEnjoyments = Array.from(this.ratingMap.values()).map((val) => val.enjoyment).filter((enj) => enj != null);
            this.avgEnjoyment = allEnjoyments.reduce((sum, val) => sum + val, 0) * 1.0 / allEnjoyments.length;
        }

        return this.avgEnjoyment;
    }

    getLevelInfo(levelID) {
        const {enjoyment, ...levelInfo} = this.ratingMap.get(levelID);
        return levelInfo;
    }

    addEnjRating(levelID, enjoyment, levelInfo) {
        if (enjoyment < 0 || enjoyment > 10) {
            return null;
        }

        this.ratingMap.set(levelID, {enjoyment: enjoyment, ...levelInfo});

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
            this.compat = MAX_COMPAT;
            return MAX_COMPAT;
        }

        let totalCompat = 0;
        let numCommonLevels = 0;

        const thisUserEnjoymentArr = [];
        const mainUserEnjoymentArr = [];

        for (const [levelID, ratingInfo] of this.ratingMap) {
            const enjoyment = ratingInfo.enjoyment;
            const mainUserEnjoyment = dataManager.mainUserEnjProfile.getEnjoyment(levelID);

            thisUserEnjoymentArr.push(enjoyment);
            mainUserEnjoymentArr.push(mainUserEnjoyment);

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

        const pearsonCoeff = pearsonSimilarity(thisUserEnjoymentArr, mainUserEnjoymentArr);

        this.compat = ((numCommonLevels >= MIN_NUM_COMMON_LEVELS_FOR_MULTIPLIER) ? HIGH_NUM_COMMON_LEVELS_MULTIPLIER : 1.0) * totalCompat / numCommonLevels;
        return this.compat;
    }

    // returns a percentile relating to how much this user is compatible with the main user's enjoyments
    // higher percentile = more useful
    calculateAdjustedCompat() {
        if (this.adjustedCompat != null) {
            return this.adjustedCompat;
        }

        this.compat = this.calculateCompat();
        
        if (this.compat == null) {
            // should only rarely be the case (happens if there are no levels in common)
            this.adjustedCompat = null;
            return null;
        }

        if (dataManager.compatArr.length === 0) {
            return 0;
        }

        // assumes all compats are already sorted in ascending order
        const maxCompatValue = dataManager.compatArr[dataManager.compatArr.length - 1];
        const minCompatValue = dataManager.compatArr[0];

        // percentile-based calculation
        // for (let i = 0; i < dataManager.compatArr.length; i++) {
        //     const compatValue = dataManager.compatArr[i];
        //     if (compatValue != null && compatValue >= this.compat) {
        //         return this.adjustedCompat = (100.0 * i) / dataManager.compatArr.length;
        //     }

        // }

        // ratio-based calculation
        this.adjustedCompat = adjustToRange(this.compat, [minCompatValue, maxCompatValue], [0, 100]);

        return this.adjustedCompat;
    }
}

class DataManager {
    constructor() {
        this.reset();

        /**
         * contains a cached mapping of levels to be considered in calculation (which are the main user's completed levels
         * and the levels completed by the other users who are collected) to their levelInfo
         * note that this cache does not contain ALL levels to be considered, only ones with cached levelInfo available
         * @type {Map<number, {actualRating: number, actualEnj: number, levelName: string, levelAuthor: string, skills2DArr: [string, number][]}>}
         */
        this.cachedLevelInfo = new Map();
    }

    reset() {
        this.mainUserEnjProfile = new EnjoymentProfile();
        /**
         * other users' IDs' each mapped to their own enjoyment profiles
         * @type {Map<number, EnjoymentProfile>}
         */
        this.otherUserEnjProfileMap = new Map();
        // just contains the compatibility values of all collected players, used to calculate adjusted compat
        this.compatArr = [];
        /**
         * level ID's of possible recommendations mapped to their calculated weight, number of enj ratings
         * used in the calculation of the weight, and level info
         * @type {Map<number, {rawTotalWeight: number, weight: number, numRatings: number, skillMultiplier: number, levelInfo: {
         *          actualRating: number, actualEnj: number, levelName: string, levelAuthor: string, skills2DArr: [string, number][]
         *        }}>}
         */
        this.levelWeightsMap = new Map();

        // do NOT clear the level info cache on a reset
    }

    /**
     * 
     * @param {number} levelID 
     * @param {{actualRating: number, actualEnj: number, levelName: string, levelAuthor: string, skills2DArr: [string, number][]}} levelInfo 
     */
    addLevelInfoToCache(levelID, levelInfo, forceUpdate = false) {
        if (this.cachedLevelInfo.has(levelID) && !forceUpdate) {
            return;
        }

        this.cachedLevelInfo.set(levelID, levelInfo);
        return levelInfo;
    }

    addMainUserEnjRating(levelID, enjoyment, levelInfo) {
        return this.mainUserEnjProfile.addEnjRating(levelID, enjoyment, levelInfo);
    }

    addOtherUserEnjRating(otherUserID, otherUsername, levelID, enjoyment, levelInfo) {
        if (otherUserID === this.mainUserEnjProfile.userID) {
            return null;
        }

        if (!this.otherUserEnjProfileMap.has(otherUserID)) {
            if (this.otherUserEnjProfileMap.size >= MAX_OTHER_USERS_TO_TRACK) {
                throw new DataError("other user enj profile map is full");
            }

            this.otherUserEnjProfileMap.set(otherUserID, new EnjoymentProfile(otherUserID, otherUsername, true));
        }

        return this.otherUserEnjProfileMap.get(otherUserID).addEnjRating(levelID, enjoyment, levelInfo);
    }

    calculateAllCompats() {
        this.compatArr = [];

        for (const otherUserEnjProfile of this.otherUserEnjProfileMap.values()) {
            this.compatArr.push(otherUserEnjProfile.calculateCompat());
        }

        this.compatArr.sort((a, b) => a - b);

        for (const otherUserEnjProfile of this.otherUserEnjProfileMap.values()) {
            otherUserEnjProfile.calculateAdjustedCompat();
        }
    }

    /**
     * returns the players with the most number of levels completed in common, not to be confused with highest compatibility
     * @param {number} limit 
     */
    getMostCommonPlayers(limit) {
        return getNBest(this.otherUserEnjProfileMap.values(), limit, (a) => {
            return -1 * a.numCommonLevels;
        });
    }

    getMostCompatiblePlayers(limit = 10, minRatings = 1) {
        return getNBest(this.otherUserEnjProfileMap.values(), limit, (a) => {
            if (a.adjustedCompat == null || a.ratingMap.size < minRatings) {
                return Infinity;
            }

            return -1 * a.adjustedCompat;
        });
    }

    getLeastCompatiblePlayers(limit = 10, minRatings = 1) {
        return getNBest(this.otherUserEnjProfileMap.values(), limit, (a) => {
            if (a.adjustedCompat == null || a.ratingMap.size < minRatings) {
                return Infinity;
            }

            return a.adjustedCompat;
        });
    }

    addWeight(levelID, weightDetails, levelInfo) {
        const oldWeightData = this.levelWeightsMap.get(levelID);

        const oldRawTotalWeight = oldWeightData?.rawTotalWeight || 0;
        const oldNumRatings = oldWeightData?.numRatings || 0;

        const newRawTotalWeight = oldRawTotalWeight + weightDetails.totalWeight;
        const newNumRatings = oldNumRatings + 1;

        // old calculation: dampened sum to prevent unpopularity bias
        // the problem with this is that it will depend on the order of the weights being added
        // const newWeight = oldWeight + (weight * (1.0 / Math.sqrt(newNumRatings)));

        // new calculation: should prevent both unpopularity and popularity bias
        // turns out that levels with 1 10/10 from a compatible user still get pushed to the top 
        // const newWeight = newRawTotalWeight / (newNumRatings + STEP_3_WEIGHT_CONSTANT);

        // newer calculation: uses a logarithmic multiplier 
        // const newWeight = newRawTotalWeight * 1.0 * (STEP_3_WEIGHT_CALC_B + STEP_3_WEIGHT_CALC_A * Math.log(newNumRatings)) / newNumRatings;

        // newer v2 calculation: uses a multiplier defined by exponential decay
        //const newWeight = newRawTotalWeight * (-1.0 * Math.pow((STEP_3_WEIGHT_CALC_A2), newNumRatings) + 1) / newNumRatings;

        // newer v3 calculation: see v2 but penalizes low common user count even more
        const newWeight = newRawTotalWeight * (-1.0 * Math.pow((STEP_3_WEIGHT_CALC_A2), (newNumRatings - 0.5)) + 1) / newNumRatings;

        this.levelWeightsMap.set(levelID, {
            rawTotalWeight: newRawTotalWeight, weight: newWeight, numRatings: newNumRatings, 
            skillMultiplier: weightDetails.skillMultiplier, levelInfo: levelInfo
        });

        return newWeight;
    }

    addAllWeights(minTier = 1, maxTier = 39) {
        for (const otherUserEnjProfile of this.otherUserEnjProfileMap.values()) {
            for (const [levelID, ratingInfo] of otherUserEnjProfile.ratingMap) {
                if (this.mainUserEnjProfile.adjustedCompat == null || this.mainUserEnjProfile.isLevelCompleted(levelID)) {
                    continue;
                }

                // console.log(`calculating weight of ${ratingInfo.levelName} by ${ratingInfo.levelAuthor}`);
                // console.log(`   old weight was ${this.levelWeightsMap.get(levelID)?.weight || 0}`);

                const enjRating = ratingInfo.enjoyment;
                const adjustedEnjRating = otherUserEnjProfile.getAdjustedEnjoyment(enjRating, this.mainUserEnjProfile);
                const actualRating = ratingInfo.actualRating;
                const levelSkills = ratingInfo.skills2DArr;

                const calculatedWeightDetails = calculateWeight(adjustedEnjRating, actualRating, levelSkills, minTier, maxTier, otherUserEnjProfile.adjustedCompat, this.mainUserEnjProfile);

                this.addWeight(levelID, calculatedWeightDetails, ratingInfo);
            }
        }
    }

    getMostRecommendedLevels(limit = 9) {
        return getNBest(this.levelWeightsMap, limit, ([key, val]) => {
            return -this.levelWeightsMap.get(key).weight;
        });
    }

    getNthMostRecommendedLevel(n) {
        return getNthBest(this.levelWeightsMap, n, ([key, val]) => {
            return -this.levelWeightsMap.get(key).weight;
        });
    }

    useDebugData() {
        this.reset();

        this.mainUserEnjProfile.setUserID(92);
        this.mainUserEnjProfile.setUsername("diffieHellmanSpongebob93229"); 

        // these may not be accurate but this is for debug purposes anyway
        const CLUBSTEP = {
            actualRating: 3,
            actualEnj: 7,
            levelName: "Clubstep",
            levelAuthor: "RobTop",
            skills2DArr: []
        };
        const TOE2 = {
            actualRating: 3,
            actualEnj: 7,
            levelName: "Theory of Everything 2",
            levelAuthor: "RobTop",
            skills2DArr: []
        };
        const DEADLOCKED = {
            actualRating: 5,
            actualEnj: 7,
            levelName: "Deadlocked",
            levelAuthor: "RobTop",
            skills2DArr: []
        };
        const DIGITAL_DESCENT = {
            actualRating: 28,
            actualEnj: 6,
            levelName: "Digital Descent",
            levelAuthor: "CP hoarder",
            skills2DArr: []
        };
        const AZURITE_SILLOW = {
            actualRating: 21,
            actualEnj: 6,
            levelName: "Azurite",
            levelAuthor: "Sillow",
            skills2DArr: []
        };
        const LAZURITE = {
            actualRating: 5,
            actualEnj: 5,
            levelName: "Lazurite",
            levelAuthor: "i forgot",
            skills2DArr: []
        };
        const AZURITE_ROYEN = {
            actualRating: 25,
            actualEnj: 8,
            levelName: "Azurite",
            levelAuthor: "royen",
            skills2DArr: []
        };
        const HEAVENS_DOOR = {
            actualRating: 24,
            actualEnj: 10,
            levelName: "Heavens Door",
            levelAuthor: "God",
            skills2DArr: []
        };
        const ETHEREAL_ARTIFICE = {
            actualRating: 27,
            actualEnj: 8,
            levelName: "Ethereal Artifice",
            levelAuthor: "Mythra",
            skills2DArr: []
        };
        const NEXT_STAGE = {
            actualRating: 30,
            actualEnj: 5,
            levelName: "Next Stage",
            levelAuthor: "zipixbox",
            skills2DArr: []
        };
        const SLAUGHTERHOUSE = {
            actualRating: 38,
            actualEnj: 3,
            levelName: "Slaughterhouse",
            levelAuthor: "IcEDCave",
            skills2DArr: []
        };
        const DOESNT_EXIST = {
            actualRating: 39,
            actualEnj: 10,
            levelName: "angelicide 6",
            levelAuthor: "me",
            skills2DArr: []
        };
        const DOESNT_EXIST_2 = {
            actualRating: 1,
            actualEnj: 0,
            levelName: "angelicide 67",
            levelAuthor: "me",
            skills2DArr: []
        };
        const DOESNT_EXIST_3 = {
            actualRating: 12,
            actualEnj: 5,
            levelName: "stop",
            levelAuthor: "itsadvystylez",
            skills2DArr: []
        };

        this.addMainUserEnjRating(1, 3, CLUBSTEP);
        this.addMainUserEnjRating(2, 3, TOE2);
        this.addMainUserEnjRating(3, 9, DEADLOCKED);

        this.addOtherUserEnjRating(666666, "IncompatibleGuy", 1, 10, CLUBSTEP); 
        this.addOtherUserEnjRating(666666, "IncompatibleGuy", 2, 10, TOE2); 
        this.addOtherUserEnjRating(666666, "IncompatibleGuy", 3, 1, DEADLOCKED); 
        this.addOtherUserEnjRating(666666, "IncompatibleGuy", 37456092, 10, DIGITAL_DESCENT); 
        this.addOtherUserEnjRating(666666, "IncompatibleGuy", 62214792, 10, AZURITE_SILLOW); 
        this.addOtherUserEnjRating(666666, "IncompatibleGuy", 42566186, 10, LAZURITE); 
        this.addOtherUserEnjRating(666666, "IncompatibleGuy", 59533451, 10, AZURITE_ROYEN); 
        this.addOtherUserEnjRating(666666, "IncompatibleGuy", 23232233, 10, DOESNT_EXIST_2); 
        this.addOtherUserEnjRating(666666, "IncompatibleGuy", 23232234, 10, DOESNT_EXIST_3); 

        this.addOtherUserEnjRating(676767, "CompatibleGamer727", 1, 2, CLUBSTEP);
        this.addOtherUserEnjRating(676767, "CompatibleGamer727", 2, 2, TOE2);
        this.addOtherUserEnjRating(676767, "CompatibleGamer727", 3, 8, DEADLOCKED);
        this.addOtherUserEnjRating(676767, "CompatibleGamer727", 37456092, 3, DIGITAL_DESCENT); 
        this.addOtherUserEnjRating(676767, "CompatibleGamer727", 62214792, 5, AZURITE_SILLOW); 
        this.addOtherUserEnjRating(676767, "CompatibleGamer727", 91739197, 10, HEAVENS_DOOR); 
        this.addOtherUserEnjRating(676767, "CompatibleGamer727", 58252259, 9, ETHEREAL_ARTIFICE); 
        this.addOtherUserEnjRating(676767, "CompatibleGamer727", 132898839, 10, NEXT_STAGE); 
        this.addOtherUserEnjRating(676767, "CompatibleGamer727", 27690100, 10, SLAUGHTERHOUSE); 
        this.addOtherUserEnjRating(676767, "CompatibleGamer727", 222222, 10, DOESNT_EXIST); 
    }
}

export const dataManager = new DataManager();
window.dataManager = dataManager;