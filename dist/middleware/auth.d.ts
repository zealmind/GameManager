import { Request, Response, NextFunction } from 'express';
export declare function hashPassword(password: string): string;
export declare function verifyPassword(password: string, stored: string): boolean;
export declare function signJwt(userId: string): string;
export declare function authenticate(req: Request, res: Response, next: NextFunction): Promise<Response<any, Record<string, any>> | undefined>;
export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email: string;
        name: string;
        provider: string;
        avatarUrl?: string;
    };
}
//# sourceMappingURL=auth.d.ts.map