import { ReactiveEffect } from './effect'
import { warn } from './warning'

let activeEffectScope: EffectScope | undefined

export class EffectScope {
  active = true
  effects: ReactiveEffect[] = []
  cleanups: (() => void)[] = []

  parent: EffectScope | undefined
  scopes: EffectScope[] | undefined
  /**
   * track a child scope's index in its parent's scopes array for optimized
   * 在其父范围数组中跟踪子范围的索引以进行优化
   * 移动
   * removal
   */
  private index: number | undefined

  constructor(detached = false) {
    if (!detached && activeEffectScope) {
      // 如果活动的范围不是空的，则将其作为父范围
      this.parent = activeEffectScope
      // 如果父范围的子范围数组不存在，则创建，index为push前的长度
      this.index =
        (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(
          this
        ) - 1
    }
  }
  // run方法
  run<T>(fn: () => T): T | undefined {
    // 如果当前范围是活动的，
    if (this.active) {
      try {
        // 将当前范围设置为活动的
        activeEffectScope = this
        // 则执行fn并返回
        return fn()
      } finally {
        // 如果当前范围是活动的，则将当前范围设置为父范围
        console.log(this)
        console.log('this.parent', this.parent)
        activeEffectScope = this.parent
      }
    } else if (__DEV__) {
      warn(`cannot run an inactive effect scope.`)
    }
  }

  on() {
    activeEffectScope = this
  }

  off() {
    activeEffectScope = this.parent
  }
  
  stop(fromParent?: boolean) {
    if (this.active) {
      let i, l
      for (i = 0, l = this.effects.length; i < l; i++) {
        this.effects[i].stop()
      }
      for (i = 0, l = this.cleanups.length; i < l; i++) {
        this.cleanups[i]()
      }
      if (this.scopes) {
        for (i = 0, l = this.scopes.length; i < l; i++) {
          this.scopes[i].stop(true)
        }
      }
      // nested scope, dereference from parent to avoid memory leaks
      if (this.parent && !fromParent) {
        // optimized O(1) removal
        const last = this.parent.scopes!.pop()
        if (last && last !== this) {
          this.parent.scopes![this.index!] = last
          last.index = this.index!
        }
      }
      this.active = false
    }
  }
}

export function effectScope(detached?: boolean) {
  return new EffectScope(detached)
}
// 记录effectscope
export function recordEffectScope(
  effect: ReactiveEffect,
  scope: EffectScope | undefined = activeEffectScope
) {
  // effect创建的时候，就将effect推进scope.effects中
  if (scope && scope.active) {
    scope.effects.push(effect)
  }
}

export function getCurrentScope() {
  return activeEffectScope
}

export function onScopeDispose(fn: () => void) {
  if (activeEffectScope) {
    activeEffectScope.cleanups.push(fn)
  } else if (__DEV__) {
    warn(
      `onScopeDispose() is called when there is no active effect scope` +
        ` to be associated with.`
    )
  }
}
