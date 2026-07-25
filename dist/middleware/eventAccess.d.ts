import { Request, Response, NextFunction } from 'express';
export declare function withEventAccess(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
export declare function requireOwnerOrModerator(req: any, res: Response, next: NextFunction): void | Response<any, Record<string, any>>;
export declare function loadEvent(req: any, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;
//# sourceMappingURL=eventAccess.d.ts.map