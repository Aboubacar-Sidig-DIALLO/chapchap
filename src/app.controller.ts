import { Controller, Get, Sse } from '@nestjs/common';
import { Observable } from 'rxjs/internal/Observable';
import { interval } from 'rxjs/internal/observable/interval';
import { map } from 'rxjs/internal/operators/map';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Sse('chrono')
  chrono(): Observable<string> {
    return interval(1000).pipe(map(() => (1000 * Math.random()).toString()));
  }
}
