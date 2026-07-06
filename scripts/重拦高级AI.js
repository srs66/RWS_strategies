// ============================================================
// 重型拦截机高级AI指挥系统 — 原版JS适配版
// 转化自rwmod战术系统，支持：集结/冲锋、引火检测、左右绕侧、残血撤退、方向平衡
// 距离限制：只锁定800码以内的敌方目标
// ============================================================

var GH = Packages.cn.tesseract.union.util.GameHelper;
var UC = Packages.com.corrodinggames.rts.strategy.game.units.class_426;

// ========== 全局配置 ==========
var TICK_GAP = 6;           // 每6tick执行一次（约0.1秒）
var MAX_RANGE = 170;        // 攻击范围
var ENGAGE_RANGE = 110;     // 接敌距离
var RETREAT_SHIELD = 150;   // 残血护盾阈值
var FULL_SHIELD = 150;      // 满血护盾阈值（用于判断已回复）

// 距离限制
var TARGET_LOCK_RANGE = 800; // 只锁定800码以内的敌方目标

// 集结参数
var RALLY_NEAR = 250;       // 集结近距离
var RALLY_FAR = 500;        // 集结远距离
var CHARGE_SPEED = 2.75;    // 冲锋速度（通过移动频率模拟）
var NORMAL_SPEED = 2.0;     // 正常速度

// 绕侧参数
var FLANK_OFFSET_NEAR = 100;   // 近距离绕侧偏移
var FLANK_OFFSET_FAR = 160;    // 远距离绕侧偏移
var FLANK_OFFSET_CHASE = 115;  // 追击绕侧偏移
var FLANK_OFFSET_MID = 60;     // 中圈绕侧偏移
var FLANK_OFFSET_LARGE = 50;   // 大圈绕侧偏移
var FLANK_RETREAT_OFFSET = 155;// 追击绕侧偏移（撤退后）

// 距离参数
var ENEMY_DETECT = 170;       // 敌方检测距离
var ENEMY_FAR = 500;        // 敌方远距离检测
var ENEMY_VERY_FAR = 600;   // 敌方超远距离
var COMMAND_RANGE = 470;    // 指挥系统范围
var RETURN_RANGE = 170;       // 返回范围
var TOO_FAR_RANGE = 800;    // 过远距离

// 战术参数
var FIRE_BAIT_RATIO = 0.5;  // 引火判定比例
var AMMO_MAX = 8;           // 弹药上限（模拟）
var TACTIC_COOLDOWN = 25;   // 战术切换冷却（tick）

// ========== 单位状态存储 ==========
var unitStates = {};

function getState(u) {
    var h = unitHash(u);
    if (!unitStates[h]) {
        unitStates[h] = {
            direction: "left",
            tactic: "缠斗",
            ammo: 0,
            isRetreating: false,
            retreatTimer: 0,
            tacticCooldown: 0,
            tacticSwitch: 0,
            isCharging: false,
            preventFar: 0,
            lastHp: -1,
            timeAlive: 0,
            isGrouped: false
        };
    }
    return unitStates[h];
}

// ========== 工具函数 ==========
function dist(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
}

function unitName(u) {
    try { return String(u.field_1988.method_1660()); } catch (e) { return "?"; }
}

function unitHash(u) {
    try { return u.hashCode(); } catch (e) { return 0; }
}

function getX(u) { try { return u.field_4227; } catch (e) { return 0; } }
function getY(u) { try { return u.field_4228; } catch (e) { return 0; } }
function getTeam(u) { 
    try { 
        var p = u.field_1927; 
        return p ? p.field_1464 : -1; 
    } catch (e) { return -1; }
}
function getShield(u) {
    try { return u.field_4233; } catch (e) { return 999; }
}
function getMaxShield(u) {
    try { return u.field_4234; } catch (e) { return 999; }
}
function isAI(u) {
    try { return u.field_1927.field_1465; } catch (e) { return false; }
}
function isAttacking(u) {
    try { return u.field_4222; } catch (e) { return false; }
}

function isMyInterceptor(u, myTeam) {
    try {
        if (getTeam(u) !== myTeam) return false;
        var name = unitName(u).toLowerCase();
        return name.indexOf("heavy") >= 0 && (name.indexOf("interceptor") >= 0 || name.indexOf("intercept") >= 0);
    } catch (e) { return false; }
}

function isEnemyInterceptor(u, myTeam) {
    try {
        var team = getTeam(u);
        if (team === myTeam || team < 0) return false;
        var name = unitName(u).toLowerCase();
        return name.indexOf("heavy") >= 0 && (name.indexOf("interceptor") >= 0 || name.indexOf("intercept") >= 0);
    } catch (e) { return false; }
}

function isEnemyAirUnit(u, myTeam) {
    try {
        var team = getTeam(u);
        if (team === myTeam || team < 0) return false;
        var name = unitName(u).toLowerCase();
        var ground = ["factory","builder","extractor","turret","generator","repair","lab","outpost","base","command","radar","shield","antinuke","nuke","fabricator","constructor","tank","artillery","mech","infantry","soldier","cannon","hover","spider","crawler","bot","droid","vessel","ship","sub","boat","naval","sea","destroyer","battleship","frigate","cruiser","carrier","resource","mine","tree","rock","crystal","oil","metal"];
        for (var i = 0; i < ground.length; i++) {
            if (name.indexOf(ground[i]) >= 0) return false;
        }
        var air = ["interceptor","helicopter","heli","bomber","gunship","dropship","missileship","air","aircraft","jet","fighter","copter","chopper","plane","flyer","drone","scout"];
        for (var i = 0; i < air.length; i++) {
            if (name.indexOf(air[i]) >= 0) return true;
        }
        return false;
    } catch (e) { return false; }
}

function moveUnit(u, tx, ty, game) {
    try {
        var act = game.field_6412.method_2058(u.field_1927);
        act.method_2139(u);
        act.method_2134(tx, ty);
    } catch (e) {}
}

// ========== 核心战术函数 ==========

function getEnemyInterceptors(units, myTeam) {
    var list = [];
    for (var i = 0; i < units.length; i++) {
        if (isEnemyInterceptor(units[i], myTeam)) list.push(units[i]);
    }
    return list;
}

function getEnemyAirUnits(units, myTeam) {
    var list = [];
    for (var i = 0; i < units.length; i++) {
        if (isEnemyAirUnit(units[i], myTeam)) list.push(units[i]);
    }
    return list;
}

function distToNearest(x, y, units) {
    var minD = Infinity;
    for (var i = 0; i < units.length; i++) {
        var d = dist(x, y, getX(units[i]), getY(units[i]));
        if (d < minD) minD = d;
    }
    return minD;
}

function countFriendlyInRange(x, y, units, range) {
    var count = 0;
    for (var i = 0; i < units.length; i++) {
        if (dist(x, y, getX(units[i]), getY(units[i])) <= range) count++;
    }
    return count;
}

function countEnemyInRange(x, y, enemies, range) {
    var count = 0;
    for (var i = 0; i < enemies.length; i++) {
        if (dist(x, y, getX(enemies[i]), getY(enemies[i])) <= range) count++;
    }
    return count;
}

function findNearestEnemy(x, y, enemies) {
    var nearest = null, minD = Infinity;
    for (var i = 0; i < enemies.length; i++) {
        var d = dist(x, y, getX(enemies[i]), getY(enemies[i]));
        if (d < minD) { minD = d; nearest = enemies[i]; }
    }
    return { unit: nearest, dist: minD };
}

function findNearestFriendly(x, y, units) {
    var nearest = null, minD = Infinity;
    for (var i = 0; i < units.length; i++) {
        var d = dist(x, y, getX(units[i]), getY(units[i]));
        if (d < minD) { minD = d; nearest = units[i]; }
    }
    return { unit: nearest, dist: minD };
}

function calcEnemyCenter(enemies) {
    var cx = 0, cy = 0;
    for (var i = 0; i < enemies.length; i++) {
        cx += getX(enemies[i]);
        cy += getY(enemies[i]);
    }
    return { x: cx / enemies.length, y: cy / enemies.length };
}

function calcFriendlyCenter(units) {
    var cx = 0, cy = 0;
    for (var i = 0; i < units.length; i++) {
        cx += getX(units[i]);
        cy += getY(units[i]);
    }
    return { x: cx / units.length, y: cy / units.length };
}

function getPerpendicular(dx, dy, isLeft) {
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) len = 1;
    if (isLeft) {
        return { x: -dy / len, y: dx / len };
    } else {
        return { x: dy / len, y: -dx / len };
    }
}

function calcFlankPoint(ex, ey, ux, uy, offset, isLeft) {
    var dx = ux - ex;
    var dy = uy - ey;
    var perp = getPerpendicular(dx, dy, isLeft);
    return {
        x: ex + perp.x * offset,
        y: ey + perp.y * offset
    };
}

function calcRetreatPoint(ux, uy, ex, ey, distance) {
    var dx = ux - ex;
    var dy = uy - ey;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) len = 1;
    return {
        x: ux + (dx / len) * distance,
        y: uy + (dy / len) * distance
    };
}

function calcReturnPoint(ux, uy, cx, cy, distance) {
    var dx = cx - ux;
    var dy = cy - uy;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) len = 1;
    return {
        x: ux + (dx / len) * distance,
        y: uy + (dy / len) * distance
    };
}

// ========== 主循环 ==========
var tickCounter = 0;

function onTick(tick) {
    tickCounter++;
    if (tickCounter % TICK_GAP !== 0) return;

    try {
        var game = GH.game;
        var me = game.field_6373;
        if (!me) return;
        var myTeam = me.field_1464;

        var ul = UC.field_1908;
        if (!ul) return;
        var sz = ul.size();

        // 收集所有单位
        var myInterceptors = [];
        var enemyInterceptors = [];
        var enemyAirUnits = [];
        var allUnits = [];

        for (var i = 0; i < sz; i++) {
            var u = ul.get(i);
            if (!u || u.field_1925 || u.field_4222) continue;
            allUnits.push(u);

            if (isMyInterceptor(u, myTeam)) {
                myInterceptors.push(u);
            } else if (isEnemyInterceptor(u, myTeam)) {
                enemyInterceptors.push(u);
            } else if (isEnemyAirUnit(u, myTeam)) {
                enemyAirUnits.push(u);
            }
        }

        if (myInterceptors.length === 0) return;

        // 计算我方中心点（用于距离限制判断）
        var myCenter = calcFriendlyCenter(myInterceptors);

        // 过滤敌方目标：只保留800码以内的
        var allEnemies = [];

        // 先收集所有敌方重型拦截机
        for (var i = 0; i < enemyInterceptors.length; i++) {
            var dToMyCenter = dist(myCenter.x, myCenter.y, getX(enemyInterceptors[i]), getY(enemyInterceptors[i]));
            if (dToMyCenter <= TARGET_LOCK_RANGE) {
                allEnemies.push(enemyInterceptors[i]);
            }
        }

        // 再收集其他空中单位（同样限制800码）
        for (var i = 0; i < enemyAirUnits.length; i++) {
            var dToMyCenter = dist(myCenter.x, myCenter.y, getX(enemyAirUnits[i]), getY(enemyAirUnits[i]));
            if (dToMyCenter <= TARGET_LOCK_RANGE) {
                allEnemies.push(enemyAirUnits[i]);
            }
        }

        // 如果800码内没有敌人，返回集结点或巡逻
        if (allEnemies.length === 0) {
            handleNoEnemies(myInterceptors, game, myCenter);
            return;
        }

        // 计算集结中心
        var rallyCenter = calcFriendlyCenter(myInterceptors);

        // 计算敌方中心（只基于800码内的敌人）
        var enemyCenter = calcEnemyCenter(allEnemies);

        // 集结检测
        var nearCount = countFriendlyInRange(rallyCenter.x, rallyCenter.y, myInterceptors, RALLY_NEAR);
        var farCount = countFriendlyInRange(rallyCenter.x, rallyCenter.y, myInterceptors, RALLY_FAR);
        var isFullyGrouped = (nearCount === farCount && farCount > 0);

        // 引火检测（只基于800码内的敌方重型拦截机）
        var fireBaitCount = 0;
        var enemyHeavyInRange = [];
        for (var i = 0; i < enemyInterceptors.length; i++) {
            var dToMyCenter = dist(myCenter.x, myCenter.y, getX(enemyInterceptors[i]), getY(enemyInterceptors[i]));
            if (dToMyCenter <= TARGET_LOCK_RANGE) {
                enemyHeavyInRange.push(enemyInterceptors[i]);
            }
        }

        for (var i = 0; i < enemyHeavyInRange.length; i++) {
            var ex = getX(enemyHeavyInRange[i]);
            var ey = getY(enemyHeavyInRange[i]);
            var dToMy = distToNearest(ex, ey, myInterceptors);
            if (dToMy > 170 && dToMy < 250) {
                fireBaitCount++;
            }
        }
        var isFireBaiting = (enemyHeavyInRange.length > 0 && fireBaitCount >= enemyHeavyInRange.length * 0.4);

        // 方向平衡
        var leftCount = 0, rightCount = 0;
        for (var i = 0; i < myInterceptors.length; i++) {
            var state = getState(myInterceptors[i]);
            if (state.direction === "left") leftCount++;
            else rightCount++;
        }

        // 为未分组单位分配方向
        for (var i = 0; i < myInterceptors.length; i++) {
            var state = getState(myInterceptors[i]);
            if (!state.isGrouped) {
                if (leftCount <= rightCount) {
                    state.direction = "left";
                    leftCount++;
                } else {
                    state.direction = "right";
                    rightCount++;
                }
                state.isGrouped = true;
            }
        }

        // 动态方向平衡调整
        for (var i = 0; i < myInterceptors.length; i++) {
            var state = getState(myInterceptors[i]);
            if (state.isRetreating || state.preventFar > 0) continue;

            if (leftCount > rightCount + 1 && state.direction === "left" && Math.random() < 0.3) {
                state.direction = "right";
                leftCount--; rightCount++;
            }
            if (rightCount > leftCount + 1 && state.direction === "right" && Math.random() < 0.3) {
                state.direction = "left";
                rightCount--; leftCount++;
            }
        }

        // ========== 逐个单位处理 ==========
        for (var i = 0; i < myInterceptors.length; i++) {
            var u = myInterceptors[i];
            var state = getState(u);
            var ux = getX(u), uy = getY(u);
            var shield = getShield(u);
            var isLeft = (state.direction === "left");

            // 更新状态
            state.timeAlive++;
            if (state.tacticCooldown > 0) state.tacticCooldown--;
            if (state.retreatTimer > 0) state.retreatTimer--;
            if (state.preventFar > 0) state.preventFar--;

            // 检测受击
            var curHp = shield;
            if (state.lastHp > 0 && curHp < state.lastHp) {
                state.ammo = Math.min(state.ammo + 1, AMMO_MAX);
            }
            state.lastHp = curHp;

            // 残血检测
            var isLowHp = (shield < RETREAT_SHIELD);
            var isFullHp = (shield >= FULL_SHIELD);

            if (isLowHp && state.retreatTimer === 0) {
                state.isRetreating = true;
                state.retreatTimer = 70;
            }
            if (isFullHp && state.retreatTimer === 0) {
                state.isRetreating = false;
            }

            // 战术切换逻辑
            if (state.tacticCooldown <= 0) {
                if (isFireBaiting && state.tactic !== "拉扯") {
                    state.tactic = "拉扯";
                    state.tacticCooldown = TACTIC_COOLDOWN;
                    state.tacticSwitch = 0;
                } else if (!isFireBaiting && state.tactic === "拉扯") {
                    state.tactic = "缠斗";
                    state.tacticCooldown = 0;
                }
            }
            if (state.tacticSwitch < 5 && state.tacticCooldown <= 0) {
                state.tacticSwitch += 0.1;
            }

            // 死斗模式
            var hasDeadFightNearby = false;
            for (var j = 0; j < myInterceptors.length; j++) {
                if (myInterceptors[j] !== u) {
                    var otherState = getState(myInterceptors[j]);
                    if (otherState.tactic === "死斗" && dist(ux, uy, getX(myInterceptors[j]), getY(myInterceptors[j])) < 450) {
                        hasDeadFightNearby = true;
                        break;
                    }
                }
            }
            if (hasDeadFightNearby && !isLowHp) {
                state.tactic = "死斗";
                state.ammo = 0;
            }
            if (state.tactic === "死斗" && state.tacticSwitch > 1.5) {
                state.tactic = "缠斗";
            }

            // 找最近的敌人（只会在800码内的敌人中找）
            var nearest = findNearestEnemy(ux, uy, allEnemies);
            var nearestEnemy = nearest.unit;
            var nearestDist = nearest.dist;

            if (!nearestEnemy) {
                // 800码内没有敌人，返回集结点
                var retPoint = calcReturnPoint(ux, uy, rallyCenter.x, rallyCenter.y, 200);
                moveUnit(u, retPoint.x, retPoint.y, game);
                continue;
            }

            var ex = getX(nearestEnemy), ey = getY(nearestEnemy);

            // ========== 距离过远，返回指挥地点 ==========
            var distToRally = dist(ux, uy, rallyCenter.x, rallyCenter.y);
            if (distToRally > COMMAND_RANGE && !state.isRetreating) {
                state.preventFar = 3;
            }
            if (state.preventFar > 0) {
                var returnPt = calcReturnPoint(ux, uy, rallyCenter.x, rallyCenter.y, 300);
                moveUnit(u, returnPt.x, returnPt.y, game);
                if (distToRally < RETURN_RANGE) {
                    state.preventFar = 0;
                }
                continue;
            }

            // ========== 残血撤退逻辑 ==========
            if (state.isRetreating && state.retreatTimer > 0) {
                var retreatPt = calcRetreatPoint(ux, uy, ex, ey, 400);

                if (isLeft) {
                    retreatPt.x -= 400;
                } else {
                    retreatPt.x += 400;
                }

                moveUnit(u, retreatPt.x, retreatPt.y, game);

                if (state.retreatTimer <= 1) {
                    state.direction = isLeft ? "right" : "left";
                    state.ammo = 0;
                    state.isRetreating = false;
                }
                continue;
            }

            // ========== 集结/冲锋逻辑 ==========
            if (isFullyGrouped && !state.isCharging) {
                state.isCharging = true;
            }
            if (!isFullyGrouped) {
                state.isCharging = false;
            }

            if (state.isCharging && state.tactic !== "拉扯") {
                var chargePt = calcReturnPoint(ux, uy, enemyCenter.x, enemyCenter.y, 200);
                moveUnit(u, chargePt.x, chargePt.y, game);
                continue;
            }

            // 等待集结
            var distToNearestFriend = findNearestFriendly(ux, uy, myInterceptors).dist;
            if (!isFullyGrouped && distToNearestFriend > RALLY_NEAR && distToNearestFriend < RALLY_FAR) {
                var gatherPt = calcReturnPoint(ux, uy, rallyCenter.x, rallyCenter.y, 100);
                moveUnit(u, gatherPt.x, gatherPt.y, game);
                continue;
            }

            // ========== 缠斗/死斗模式：左右绕侧 ==========
            if (state.tactic === "缠斗" || state.tactic === "死斗") {
                var offset = FLANK_OFFSET_NEAR;
                var enemyCountNear = countEnemyInRange(ex, ey, allEnemies, ENEMY_FAR);

                if (enemyCountNear > 28) {
                    offset = FLANK_OFFSET_LARGE;
                } else if (enemyCountNear > 14) {
                    offset = FLANK_OFFSET_MID;
                } else if (nearestDist < ENEMY_DETECT && state.ammo > 0) {
                    offset = FLANK_OFFSET_CHASE;
                }

                if (state.tactic === "拉扯") {
                    offset += 50;
                }

                var flankPt = calcFlankPoint(ex, ey, ux, uy, offset, isLeft);

                if (nearestDist <= MAX_RANGE && nearestDist >= 100 && !isLowHp) {
                    if (nearestDist < 130) {
                        var backPt = calcRetreatPoint(ux, uy, ex, ey, 30);
                        moveUnit(u, backPt.x, backPt.y, game);
                    }
                    continue;
                }

                if (nearestDist < 100) {
                    var backPt = calcRetreatPoint(ux, uy, ex, ey, ENGAGE_RANGE - nearestDist + 20);
                    moveUnit(u, backPt.x, backPt.y, game);
                    continue;
                }

                moveUnit(u, flankPt.x, flankPt.y, game);
                continue;
            }

            // ========== 拉扯模式 ==========
            if (state.tactic === "拉扯") {
                var flankPt = calcFlankPoint(ex, ey, ux, uy, FLANK_OFFSET_FAR + 50, isLeft);

                if (nearestDist > MAX_RANGE) {
                    moveUnit(u, flankPt.x, flankPt.y, game);
                } else if (nearestDist < 120) {
                    var backPt = calcRetreatPoint(ux, uy, ex, ey, 100);
                    moveUnit(u, backPt.x, backPt.y, game);
                }
                continue;
            }

            // 默认
            var defaultPt = calcReturnPoint(ux, uy, rallyCenter.x, rallyCenter.y, 150);
            moveUnit(u, defaultPt.x, defaultPt.y, game);
        }

    } catch (e) {}
}

// ========== 无敌人时的处理 ==========
function handleNoEnemies(units, game, center) {
    if (units.length === 0) return;

    var cx = center.x;
    var cy = center.y;

    for (var i = 0; i < units.length; i++) {
        var u = units[i];
        var state = getState(u);
        var ux = getX(u), uy = getY(u);

        var d = dist(ux, uy, cx, cy);
        if (d > 200) {
            var pt = calcReturnPoint(ux, uy, cx, cy, 150);
            moveUnit(u, pt.x, pt.y, game);
        }
    }
}

function init() {}
