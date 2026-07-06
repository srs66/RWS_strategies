// ============================================================
// 重型拦截机高级AI指挥系统 — 原版JS适配版
// 修复：两侧敌人时只规避最近敌人，避免被包围
// 修复：删除集结/队友跟随逻辑
// 受击时绕圈移动（沿切线方向），不中断攻击
// 距离限制：只锁定800码以内的敌方目标
// ============================================================

var GH = Packages.cn.tesseract.union.util.GameHelper;
var UC = Packages.com.corrodinggames.rts.strategy.game.units.class_426;

// ========== 全局配置 ==========
var TICK_GAP = 6;
var MAX_RANGE = 170;
var ENGAGE_RANGE = 110;
var RETREAT_SHIELD = 150;
var FULL_SHIELD = 150;
var TARGET_LOCK_RANGE = 800;

// 绕侧参数
var FLANK_OFFSET_NEAR = 100;
var FLANK_OFFSET_FAR = 160;
var FLANK_OFFSET_CHASE = 115;
var FLANK_OFFSET_MID = 60;
var FLANK_OFFSET_LARGE = 50;

// 距离参数
var ENEMY_DETECT = 170;
var ENEMY_FAR = 500;
var COMMAND_RANGE = 470;
var RETURN_RANGE = 170;

// 战术参数
var FIRE_BAIT_RATIO = 0.5;
var AMMO_MAX = 8;
var TACTIC_COOLDOWN = 25;

// 绕圈参数
var ORBIT_SPEED = 60;       // 绕圈移动距离（每tick）
var ORBIT_DURATION = 40;    // 绕圈持续时间（tick，约4秒）

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
            preventFar: 0,
            lastHp: -1,
            timeAlive: 0,
            isGrouped: false,
            isOrbiting: false,      // 是否正在绕圈
            orbitTimer: 0,          // 绕圈计时器
            orbitDirection: 1       // 绕圈方向：1=顺时针，-1=逆时针
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

function calcEnemyCenter(enemies) {
    var cx = 0, cy = 0;
    for (var i = 0; i < enemies.length; i++) {
        cx += getX(enemies[i]);
        cy += getY(enemies[i]);
    }
    return { x: cx / enemies.length, y: cy / enemies.length };
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

// 计算绕圈目标点（沿切线方向移动，保持距离不变）
function calcOrbitPoint(ex, ey, ux, uy, orbitDir, speed) {
    var dx = ux - ex;
    var dy = uy - ey;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) len = 1;

    // 当前距离敌人的距离
    var curDist = len;

    // 切线方向（垂直于敌人->我的向量）
    // orbitDir: 1 = 顺时针, -1 = 逆时针
    var tangentX = orbitDir * (dy / len);
    var tangentY = orbitDir * (-dx / len);

    // 沿切线移动，同时微调保持距离
    var targetX = ux + tangentX * speed;
    var targetY = uy + tangentY * speed;

    // 确保保持距离在攻击范围内
    var newDx = targetX - ex;
    var newDy = targetY - ey;
    var newLen = Math.sqrt(newDx * newDx + newDy * newDy);
    if (newLen > 0) {
        // 如果距离变化太大，调整回合理范围
        if (newLen > MAX_RANGE) {
            var scale = MAX_RANGE / newLen;
            targetX = ex + newDx * scale;
            targetY = ey + newDy * scale;
        } else if (newLen < 100) {
            var scale = 100 / newLen;
            targetX = ex + newDx * scale;
            targetY = ey + newDy * scale;
        }
    }

    return { x: targetX, y: targetY };
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

        // 只收集我方重拦截和敌方单位
        var myInterceptors = [];
        var enemyInterceptors = [];
        var enemyAirUnits = [];

        for (var i = 0; i < sz; i++) {
            var u = ul.get(i);
            if (!u || u.field_1925 || u.field_4222) continue;

            if (isMyInterceptor(u, myTeam)) {
                myInterceptors.push(u);
            } else if (isEnemyInterceptor(u, myTeam)) {
                enemyInterceptors.push(u);
            } else if (isEnemyAirUnit(u, myTeam)) {
                enemyAirUnits.push(u);
            }
        }

        if (myInterceptors.length === 0) return;

        // 计算我方中心点（仅用于距离限制）
        var myCenterX = 0, myCenterY = 0;
        for (var i = 0; i < myInterceptors.length; i++) {
            myCenterX += getX(myInterceptors[i]);
            myCenterY += getY(myInterceptors[i]);
        }
        myCenterX /= myInterceptors.length;
        myCenterY /= myInterceptors.length;

        // 过滤敌方目标：只保留800码以内的
        var allEnemies = [];
        var enemyHeavyInRange = [];

        for (var i = 0; i < enemyInterceptors.length; i++) {
            var dToMyCenter = dist(myCenterX, myCenterY, getX(enemyInterceptors[i]), getY(enemyInterceptors[i]));
            if (dToMyCenter <= TARGET_LOCK_RANGE) {
                allEnemies.push(enemyInterceptors[i]);
                enemyHeavyInRange.push(enemyInterceptors[i]);
            }
        }

        for (var i = 0; i < enemyAirUnits.length; i++) {
            var dToMyCenter = dist(myCenterX, myCenterY, getX(enemyAirUnits[i]), getY(enemyAirUnits[i]));
            if (dToMyCenter <= TARGET_LOCK_RANGE) {
                allEnemies.push(enemyAirUnits[i]);
            }
        }

        // 800码内没有敌人，不执行任何移动指令
        if (allEnemies.length === 0) {
            return;
        }

        // 计算敌方中心
        var enemyCenter = calcEnemyCenter(allEnemies);

        // 引火检测（只基于我方重拦截与敌方距离）
        var fireBaitCount = 0;
        for (var i = 0; i < enemyHeavyInRange.length; i++) {
            var ex = getX(enemyHeavyInRange[i]);
            var ey = getY(enemyHeavyInRange[i]);
            var dToMy = Infinity;
            for (var j = 0; j < myInterceptors.length; j++) {
                var d = dist(ex, ey, getX(myInterceptors[j]), getY(myInterceptors[j]));
                if (d < dToMy) dToMy = d;
            }
            if (dToMy > 170 && dToMy < 250) {
                fireBaitCount++;
            }
        }
        var isFireBaiting = (enemyHeavyInRange.length > 0 && fireBaitCount >= enemyHeavyInRange.length * 0.4);

        // 方向平衡（只在我方重拦截之间）
        var leftCount = 0, rightCount = 0;
        for (var i = 0; i < myInterceptors.length; i++) {
            var state = getState(myInterceptors[i]);
            if (state.direction === "left") leftCount++;
            else rightCount++;
        }

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

        // 动态方向平衡
        for (var i = 0; i < myInterceptors.length; i++) {
            var state = getState(myInterceptors[i]);
            if (state.isRetreating || state.preventFar > 0 || state.isOrbiting) continue;

            if (leftCount > rightCount + 1 && state.direction === "left" && Math.random() < 0.3) {
                state.direction = "right";
                leftCount--; rightCount++;
            }
            if (rightCount > leftCount + 1 && state.direction === "right" && Math.random() < 0.3) {
                state.direction = "left";
                rightCount--; leftCount++;
            }
        }

        // ========== 逐个单位独立处理（完全无视队友） ==========
        for (var i = 0; i < myInterceptors.length; i++) {
            var u = myInterceptors[i];
            var state = getState(u);
            var ux = getX(u), uy = getY(u);
            var shield = getShield(u);
            var isLeft = (state.direction === "left");

            // 更新状态计时器
            state.timeAlive++;
            if (state.tacticCooldown > 0) state.tacticCooldown--;
            if (state.retreatTimer > 0) state.retreatTimer--;
            if (state.preventFar > 0) state.preventFar--;
            if (state.orbitTimer > 0) state.orbitTimer--;

            // 检测受击
            var curHp = shield;
            var wasHit = false;
            if (state.lastHp > 0 && curHp < state.lastHp) {
                state.ammo = Math.min(state.ammo + 1, AMMO_MAX);
                state.lastHitTime = state.timeAlive;
                wasHit = true;
            }
            state.lastHp = curHp;

            // 找最近的敌人
            var nearest = findNearestEnemy(ux, uy, allEnemies);
            var nearestEnemy = nearest.unit;
            var nearestDist = nearest.dist;

            if (!nearestEnemy) {
                continue;
            }

            var ex = getX(nearestEnemy), ey = getY(nearestEnemy);

            // ========== 核心：受击时绕圈移动 ==========
            if (wasHit && !state.isRetreating) {
                state.isOrbiting = true;
                state.orbitTimer = ORBIT_DURATION;
                // 随机选择绕圈方向（与单位方向一致）
                state.orbitDirection = isLeft ? -1 : 1;
            }

            if (state.isOrbiting && state.orbitTimer > 0) {
                // 沿切线方向绕圈移动，保持距离不变
                var orbitPt = calcOrbitPoint(ex, ey, ux, uy, state.orbitDirection, ORBIT_SPEED);
                moveUnit(u, orbitPt.x, orbitPt.y, game);

                // 绕圈结束
                if (state.orbitTimer <= 0) {
                    state.isOrbiting = false;
                }
                continue;
            }

            // ========== 残血撤退（只远离最近敌人） ==========
            var isLowHp = (shield < RETREAT_SHIELD);
            var isFullHp = (shield >= FULL_SHIELD);

            if (isLowHp && state.retreatTimer === 0) {
                state.isRetreating = true;
                state.retreatTimer = 70;
                state.isOrbiting = false;
            }
            if (isFullHp && state.retreatTimer === 0) {
                state.isRetreating = false;
            }

            if (state.isRetreating && state.retreatTimer > 0) {
                var retreatPt = calcRetreatPoint(ux, uy, ex, ey, 400);
                moveUnit(u, retreatPt.x, retreatPt.y, game);

                if (state.retreatTimer <= 1) {
                    state.direction = isLeft ? "right" : "left";
                    state.ammo = 0;
                    state.isRetreating = false;
                }
                continue;
            }

            // ========== 战术切换 ==========
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

            // 死斗模式（只看我方重拦截）
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

            // ========== 距离过远返回（返回敌方中心方向） ==========
            var distToEnemyCenter = dist(ux, uy, enemyCenter.x, enemyCenter.y);
            if (distToEnemyCenter > COMMAND_RANGE && !state.isRetreating) {
                state.preventFar = 3;
            }
            if (state.preventFar > 0) {
                var returnPt = calcReturnPoint(ux, uy, enemyCenter.x, enemyCenter.y, 300);
                moveUnit(u, returnPt.x, returnPt.y, game);
                if (distToEnemyCenter < RETURN_RANGE) {
                    state.preventFar = 0;
                }
                continue;
            }

            // ========== 缠斗/死斗：左右绕侧（只针对最近敌人） ==========
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

            // 默认：向最近敌人移动
            var defaultPt = calcReturnPoint(ux, uy, ex, ey, 150);
            moveUnit(u, defaultPt.x, defaultPt.y, game);
        }

    } catch (e) {}
}

function init() {}
