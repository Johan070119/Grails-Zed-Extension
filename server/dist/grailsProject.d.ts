export interface DomainProperty {
    name: string;
    type: string;
}
export interface DomainClass {
    name: string;
    filePath: string;
    properties: DomainProperty[];
    hasMany: Record<string, string>;
    belongsTo: Record<string, string>;
}
export interface GrailsArtifact {
    name: string;
    simpleName: string;
    filePath: string;
    kind: "controller" | "service" | "taglib" | "domain";
}
export type GrailsVersion = "2" | "3" | "4" | "5" | "6" | "7+" | "unknown";
export interface GrailsProject {
    root: string;
    version: GrailsVersion;
    domains: Map<string, DomainClass>;
    controllers: Map<string, GrailsArtifact>;
    services: Map<string, GrailsArtifact>;
    taglibs: Map<string, GrailsArtifact>;
}
export declare function detectGrailsVersion(root: string): GrailsVersion;
export declare function buildGrailsProject(root: string): GrailsProject;
