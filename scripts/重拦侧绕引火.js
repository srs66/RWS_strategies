// ============================================================
// 重拦空战微操 — 切向绕圈 + 动态引火 v11
// 基于原版结构，最小改动：
// 1. 保留原版 disruptorHashes/mainHashes 全局变量
// 2. 保留原版初始化逻辑
// 3. 新增 dynamicDisruptorHashes 标记动态引火
// 4. 800码距离 + 排除陆军
// ============================================================

var GH = Packages.cn.tesseract.union.util.GameHelper;
var UC = Packages.com.corrodinggames.rts.strategy.game.units.class_426;

var TICK_GAP = 20;
var MAX_RANGE = 170;
var ENGAGE_RANGE = 110;
var LOCK_RANGE = 800;

// 干扰机参数
var DISRUPT_APPROACH = 180;
var DISRUPT_RETREAT = 250;
var DISRUPT_RATIO = 0.4;
var RETREAT_HP_RATIO = 0.5;

// 【原版】全局变量
var disruptorHashes = {};
var mainHashes = {};

// 【新增】动态引火标记 + 血量记录
var dynamicDisruptorHashes = {};
var lastHpMap = {};

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

function isValidEnemy(u, myTeam) {
    try {
        var p = u.field_1927;
        if (!p) return false;
        var team = p.field_1464;
        if (team === myTeam) return false;
        if (team < 0) return false;
        return true;
    } catch (e) {
        return false;
    }
}

function isMyInterceptor(u, myTeam) {
    try {
        var p = u.field_1927;
        if (!p) return false;
        if (p.field_1464 !== myTeam) return false;
        var name = unitName(u);
        if (name.indexOf("interceptor") >= 0) return true;
        if (name.indexOf("Interceptor") >= 0) return true;
        if (name.indexOf("heavy") >= 0) return true;
        if (name.indexOf("Heavy") >= 0) return true;
        return false;
    } catch (e) {
        return false;
    }
}

function isEnemyAirUnit(u, myTeam) {
    try {
        if (!isValidEnemy(u, myTeam)) return false;
        var name = unitName(u);

        // 【新增】排除陆军
        var landKeywords = [
            "scout", "Scout",
            "tank", "Tank",
            "mech", "Mech",
            "builder", "Builder",
            "extractor", "Extractor",
            "factory", "Factory",
            "turret", "Turret",
            "generator", "Generator",
            "repair", "Repair",
            "lab", "Lab",
            "outpost", "Outpost",
            "base", "Base",
            "command", "Command",
            "radar", "Radar",
            "shield", "Shield",
            "antinuke", "Antinuke",
            "nuke", "Nuke",
            "fabricator", "Fabricator",
            "constructor", "Constructor",
            "artillery", "Artillery",
            "infantry", "Infantry",
            "soldier", "Soldier",
            "cannon", "Cannon",
            "hover", "Hover",
            "spider", "Spider",
            "crawler", "Crawler",
            "bot", "Bot",
            "droid", "Droid",
            "vessel", "Vessel",
            "ship", "Ship",
            "sub", "Sub",
            "boat", "Boat",
            "naval", "Naval",
            "sea", "Sea",
            "destroyer", "Destroyer",
            "battleship", "Battleship",
            "frigate", "Frigate",
            "cruiser", "Cruiser",
            "carrier", "Carrier",
            "resource", "Resource",
            "mine", "Mine",
            "tree", "Tree",
            "rock", "Rock",
            "crystal", "Crystal",
            "oil", "Oil",
            "metal", "Metal"
        ];
        for (var i = 0; i < landKeywords.length; i++) {
            if (name.indexOf(landKeywords[i]) >= 0) return false;
        }

        var airKeywords = [
            "interceptor", "Interceptor",
            "helicopter", "Helicopter", "heli", "Heli",
            "bomber", "Bomber",
            "gunShip", "GunShip", "gunship", "Gunship",
            "dropship", "Dropship",
            "missileShip", "MissileShip",
            "air", "Air", "aircraft", "Aircraft",
            "jet", "Jet", "fighter", "Fighter",
            "copter", "Copter", "chopper", "Chopper",
            "plane", "Plane", "flyer", "Flyer",
            "drone", "Drone"
        ];
        for (var i = 0; i < airKeywords.length; i++) {
            if (name.indexOf(airKeywords[i]) >= 0) return true;
        }

        return false;
    } catch (e) {
        return false;
    }
}

function getHpRatio(u) {
    try {
        var maxHp = u.field_4234;
        var curHp = u.field_4233;
        if (maxHp > 0) return curHp / maxHp;
        return 1.0;
    } catch (e) {
        return 1.0;
    }
}

function getCurrentHp(u) {
    try {
        return u.field_4233;
    } catch (e) {
        return 99999;
    }
}

var n = 0;

function onTick(tick) {
    n++;
    if (n % TICK_GAP !== 0) return;

    try {
        var game = GH.game;
        var me = game.field_6373;
        if (!me) return;
        var myTeam = me.field_1464;

        var ul = UC.field_1908;
        if (!ul) return;
        var sz = ul.size();

        var allUnits = [];
        var enemies = [];

        for (var i = 0; i < sz; i++) {
            var u = ul.get(i);
            if (!u || u.field_1925 || u.field_4222) continue;

            if (isMyInterceptor(u, myTeam)) {
                allUnits.push(u);
            } else if (isEnemyAirUnit(u, myTeam)) {
                enemies.push(u);
            }
        }

        if (allUnits.length === 0 || enemies.length === 0) return;

        // 计算我方平均位置
        var myAvgX = 0, myAvgY = 0;
        for (var i = 0; i < allUnits.length; i++) {
            myAvgX += allUnits[i].field_4227;
            myAvgY += allUnits[i].field_4228;
        }
        myAvgX /= allUnits.length;
        myAvgY /= allUnits.length;

        // 【新增】只锁定800码内的敌方空军
        var nearbyEnemies = [];
        for (var k = 0; k < enemies.length; k++) {
            var d = dist(myAvgX, myAvgY, enemies[k].field_4227, enemies[k].field_4228);
            if (d <= LOCK_RANGE) {
                nearbyEnemies.push(enemies[k]);
            }
        }

        if (nearbyEnemies.length === 0) return;

        // 计算敌方中心
        var enemyCenter = { x: 0, y: 0 };
        for (var i = 0; i < nearbyEnemies.length; i++) {
            enemyCenter.x += nearbyEnemies[i].field_4227;
            enemyCenter.y += nearbyEnemies[i].field_4228;
        }
        enemyCenter.x /= nearbyEnemies.length;
        enemyCenter.y /= nearbyEnemies.length;

        // 找最近的敌方单位
        var focusTarget = null;
        var focusTargetD = Infinity;
        for (var k = 0; k < nearbyEnemies.length; k++) {
            var d = dist(myAvgX, myAvgY, nearbyEnemies[k].field_4227, nearbyEnemies[k].field_4228);
            if (d < focusTargetD) {
                focusTargetD = d;
                focusTarget = nearbyEnemies[k];
            }
        }

        var fx = focusTarget ? focusTarget.field_4227 : enemyCenter.x;
        var fy = focusTarget ? focusTarget.field_4228 : enemyCenter.y;

        // ========== 【原版】分组逻辑，完全不变 ==========
        var currentDisruptors = [];
        var currentMain = [];
        var unassigned = [];

        for (var i = 0; i < allUnits.length; i++) {
            var h = unitHash(allUnits[i]);
            if (disruptorHashes[h] || dynamicDisruptorHashes[h]) {
                currentDisruptors.push(allUnits[i]);
            } else if (mainHashes[h]) {
                currentMain.push(allUnits[i]);
            } else {
                unassigned.push(allUnits[i]);
            }
        }

        // 【原版】初始分配：40%引火机
        if (currentDisruptors.length === 0 && currentMain.length === 0) {
            var targetDisruptCount = Math.floor(allUnits.length * DISRUPT_RATIO);
            if (targetDisruptCount < 2) targetDisruptCount = 2;

            for (var i = 0; i < allUnits.length; i++) {
                var h = unitHash(allUnits[i]);
                if (i < targetDisruptCount) {
                    disruptorHashes[h] = true;
                    currentDisruptors.push(allUnits[i]);
                } else {
                    mainHashes[h] = true;
                    currentMain.push(allUnits[i]);
                }
            }
        } else if (unassigned.length > 0) {
            for (var i = 0; i < unassigned.length; i++) {
                var h = unitHash(unassigned[i]);
                mainHashes[h] = true;
                currentMain.push(unassigned[i]);
            }
        }

        // ========== 【新增】动态引火：检测主力掉血 ==========
        for (var i = 0; i < currentMain.length; i++) {
            var u = currentMain[i];
            var h = unitHash(u);
            var curHp = getCurrentHp(u);
            var lastHp = lastHpMap[h];

            if (lastHp === undefined) {
                lastHpMap[h] = curHp;
                continue;
            }

            // 检测掉血
            if (curHp < lastHp) {
                // 被集火了！转为动态干扰机
                dynamicDisruptorHashes[h] = true;
                mainHashes[h] = false;
                // 移到干扰机列表（不 splice，下次 tick 分组时会自动归类）
            }

            lastHpMap[h] = curHp;
        }

        // 计算主力平均位置
        var mainAvgX = 0, mainAvgY = 0;
        for (var i = 0; i < currentMain.length; i++) {
            mainAvgX += currentMain[i].field_4227;
            mainAvgY += currentMain[i].field_4228;
        }
        if (currentMain.length > 0) {
            mainAvgX /= currentMain.length;
            mainAvgY /= currentMain.length;
        }

        // ========== 【原版】主力群：正面接敌 ==========
        if (focusTarget && currentMain.length > 0) {
            var fxt = focusTarget.field_4227;
            var fyt = focusTarget.field_4228;

            var dx = mainAvgX - fxt;
            var dy = mainAvgY - fyt;
            var dd = Math.sqrt(dx * dx + dy * dy);
            if (dd < 1) dd = 1;

            var rallyX = fxt + (dx / dd) * ENGAGE_RANGE;
            var rallyY = fyt + (dy / dd) * ENGAGE_RANGE;

            for (var i = 0; i < currentMain.length; i++) {
                var u = currentMain[i];
                var ux = u.field_4227, uy = u.field_4228;
                var hp = getHpRatio(u);

                if (hp < RETREAT_HP_RATIO) {
                    // 血量低不回基地，继续输出
                    continue;
                }

                var dToTarget = dist(ux, uy, fxt, fyt);

                if (dToTarget <= MAX_RANGE && dToTarget >= 100) {
                    continue;
                } else if (dToTarget < 100) {
                    var backDx = ux - fxt;
                    var backDy = uy - fyt;
                    var backD = Math.sqrt(backDx * backDx + backDy * backDy);
                    if (backD < 1) backD = 1;
                    moveUnit(u, fxt + (backDx / backD) * ENGAGE_RANGE, fyt + (backDy / backD) * ENGAGE_RANGE, game);
                } else {
                    moveUnit(u, rallyX, rallyY, game);
                }
            }
        }

        // ========== 【原版】干扰机：切向绕圈逻辑 ==========
        var leftDisruptors = [];
        var rightDisruptors = [];
        for (var i = 0; i < currentDisruptors.length; i++) {
            if (i % 2 === 0) {
                leftDisruptors.push(currentDisruptors[i]);
            } else {
                rightDisruptors.push(currentDisruptors[i]);
            }
        }

        // 左侧干扰机
        for (var i = 0; i < leftDisruptors.length; i++) {
            var u = leftDisruptors[i];
            var ux = u.field_4227, uy = u.field_4228;
            var hp = getHpRatio(u);

            // 血量低不回基地，继续绕圈

            var closestEnemy = null;
            var closestD = Infinity;
            for (var k = 0; k < nearbyEnemies.length; k++) {
                var d = dist(ux, uy, nearbyEnemies[k].field_4227, nearbyEnemies[k].field_4228);
                if (d < closestD) {
                    closestD = d;
                    closestEnemy = nearbyEnemies[k];
                }
            }

            if (!closestEnemy) continue;

            var ex = closestEnemy.field_4227;
            var ey = closestEnemy.field_4228;

            var dx = ux - ex;
            var dy = uy - ey;
            var dlen = Math.sqrt(dx * dx + dy * dy);
            if (dlen < 1) dlen = 1;

            // 左侧 = 逆时针90°
            var dirX = -dy / dlen;
            var dirY = dx / dlen;

            var targetDist;
            if (closestD < 150) {
                targetDist = DISRUPT_RETREAT;
            } else if (closestD > 220) {
                targetDist = DISRUPT_APPROACH;
            } else {
                targetDist = closestD;
            }

            var tx = ex + dirX * targetDist;
            var ty = ey + dirY * targetDist;

            moveUnit(u, tx, ty, game);
        }

        // 右侧干扰机
        for (var i = 0; i < rightDisruptors.length; i++) {
            var u = rightDisruptors[i];
            var ux = u.field_4227, uy = u.field_4228;
            var hp = getHpRatio(u);

            // 血量低不回基地，继续绕圈

            var closestEnemy = null;
            var closestD = Infinity;
            for (var k = 0; k < nearbyEnemies.length; k++) {
                var d = dist(ux, uy, nearbyEnemies[k].field_4227, nearbyEnemies[k].field_4228);
                if (d < closestD) {
                    closestD = d;
                    closestEnemy = nearbyEnemies[k];
                }
            }

            if (!closestEnemy) continue;

            var ex = closestEnemy.field_4227;
            var ey = closestEnemy.field_4228;

            var dx = ux - ex;
            var dy = uy - ey;
            var dlen = Math.sqrt(dx * dx + dy * dy);
            if (dlen < 1) dlen = 1;

            // 右侧 = 顺时针90°
            var dirX = dy / dlen;
            var dirY = -dx / dlen;

            var targetDist;
            if (closestD < 150) {
                targetDist = DISRUPT_RETREAT;
            } else if (closestD > 220) {
                targetDist = DISRUPT_APPROACH;
            } else {
                targetDist = closestD;
            }

            var tx = ex + dirX * targetDist;
            var ty = ey + dirY * targetDist;

            moveUnit(u, tx, ty, game);
        }

    } catch (e) {}
}

function moveUnit(u, tx, ty, game) {
    try {
        var act = game.field_6412.method_2058(u.field_1927);
        act.method_2139(u);
        act.method_2134(tx, ty);
    } catch (e) {}
}

function retreatToBase(u, game) {
    try {
        var me = game.field_6373;
        if (!me) return;
        var baseX = me.field_4227;
        var baseY = me.field_4228;
        var ux = u.field_4227, uy = u.field_4228;
        var dx = ux - baseX;
        var dy = uy - baseY;
        var dd = Math.sqrt(dx * dx + dy * dy);
        if (dd < 1) dd = 1;
        var tx = ux + (dx / dd) * 150;
        var ty = uy + (dy / dd) * 150;
        moveUnit(u, tx, ty, game);
    } catch (e) {}
}

function init() {}
