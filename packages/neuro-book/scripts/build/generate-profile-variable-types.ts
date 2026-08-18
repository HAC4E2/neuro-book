import path from "node:path";
import {fileURLToPath} from "node:url";
import {
    compileProfileArtifacts,
    compileVariableDefinitions,
    generateProfileVariableIdeTypes,
    PROFILE_VARIABLE_IDE_TYPES_FILE,
} from "@notnotype/neuro-book/build";

const applicationSourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const profileRoot = path.resolve(applicationSourceRoot, "assets", "workspace", ".nbook", "agent", "profiles");
const variableDefinitionRoot = path.resolve(applicationSourceRoot, "assets", "workspace", ".nbook", "agent", "variables");

await compileVariableDefinitions({
    definitionRoot: variableDefinitionRoot,
    rootLabel: "assets/workspace/.nbook/agent/variables",
    skipFresh: true,
});
await compileProfileArtifacts({
    profileRoot,
    rootLabel: "assets/workspace/.nbook/agent/profiles",
    skipFresh: true,
});

const ideTypes = await generateProfileVariableIdeTypes({
    outputPath: path.resolve(process.cwd(), PROFILE_VARIABLE_IDE_TYPES_FILE),
    variableDefinitionRoots: [variableDefinitionRoot],
    profileRoots: [profileRoot],
});

console.log(`generated profile variable IDE types: ${path.relative(process.cwd(), ideTypes.outputPath)} (${ideTypes.includedFiles.length} artifact type file(s))`);
