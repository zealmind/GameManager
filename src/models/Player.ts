import { randomUUID } from 'node:crypto';

export class Player {
  id: string;
  name: string;
  nickName: string;

  constructor(name: string, id?: string, nickName?: string) {
    this.id = id || randomUUID();
    this.name = name;
    this.nickName = nickName || '';
  }
}