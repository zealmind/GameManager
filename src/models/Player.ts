import { randomUUID } from 'node:crypto';

export class Player {
  id: string;
  name: string;
  nickName?: string;
  /** Optional DUPR (Dynamic Universal Pickleball Rating) player ID */
  duprId?: string;
  ownerId?: string;

  constructor(name: string, id?: string) {
    this.id = id || randomUUID();
    this.name = name;
  }
}
