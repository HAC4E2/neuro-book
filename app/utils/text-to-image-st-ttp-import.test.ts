import {describe, expect, it} from "vitest";
import {parseStTtpTextToImageSettings} from "nbook/app/utils/text-to-image-st-ttp-import";

describe("st-ttp text-to-image settings import", () => {
    it("extracts character, outfit and replacement rule drafts from exported settings", () => {
        const parsed = parseStTtpTextToImageSettings({
            characterPresets: {
                c1: {
                    nameCN: "井上阳葵",
                    nameEN: "Inoue Himari|Himari",
                    characterTraits: "energetic, sporty girl",
                    facialFeatures: "short brown hair",
                    facialFeaturesBack: "short brown hair, nape",
                    upperBodySFW: "white sports tank top",
                    upperBodySFWBack: "tank top from behind",
                    fullBodySFW: "navy athletic shorts",
                    fullBodySFWBack: "shorts from behind",
                    negative: "bad character",
                },
            },
            outfitPresets: {
                o1: {
                    nameCN: "运动服",
                    nameEN: "track uniform",
                    trigger: "田径服|training outfit",
                    upperBody: "white track top",
                    upperBodyBack: "racerback track top",
                    fullBody: "navy running shorts",
                    fullBodyBack: "running shorts from behind",
                    negative: "wrong uniform",
                },
            },
            promptReplaceRules: [
                {
                    name: "马 -> horse",
                    find: "马",
                    replace: "horse",
                    enabled: true,
                },
            ],
        });

        expect(parsed.characters[0]).toMatchObject({
            cnName: "井上阳葵",
            enName: "Inoue Himari|Himari",
            profileTraits: "energetic, sporty girl",
            facialAppearance: "short brown hair",
            facialBack: "short brown hair, nape",
            upperSfw: "white sports tank top",
            lowerSfw: "navy athletic shorts",
            lowerBackSfw: "shorts from behind",
        });
        expect(parsed.outfits[0]).toMatchObject({
            nameCn: "运动服",
            nameEn: "track uniform",
            aliases: "田径服|training outfit",
            upperFront: "white track top",
            lowerFront: "navy running shorts",
            negativePrompt: "wrong uniform",
        });
        expect(parsed.promptRules[0]).toMatchObject({
            name: "马 -> horse",
            trigger: "马",
            replacement: "horse",
            target: "positive",
            mode: "replace",
        });
    });
});
