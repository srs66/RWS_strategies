// ============================================================
// 重拦空战微操 — 全圆周运动版
// 核心：所有拦截机围绕敌方做无限圆周运动
// ============================================================

var GH = Packages.cn.tesseract.union.util.GameHelper;
var UC = Packages.com.corrodinggames.rts.strategy.game.units.class_426;

var TICK_GAP = 15;
var MAX_RANGE = 170;
var ENGAGE_RANGE = 110;

// 干扰机参数
var DISRUPT_APPROACH = 180;
var DISRUPT_RETREAT = 250;
var DISRUPT_RATIO = 0.4;
var RETREAT_HP_RATIO = 0.3;

// 圆周运动参数
var ORBIT_RADIUS = 140;
var ORBIT_SPEED = 0.1;

var disruptorHashes = {};
var mainHashes = {};

// 圆周运动状态缓存
var orbitStates = {};

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

        var excludeKeywords = [
            "factory", "Factory", "builder", "Builder", "extractor", "Extractor",
            "turret", "Turret", "generator", "Generator", "repair", "Repair",
            "lab", "Lab", "outpost", "Outpost", "base", "Base", "command", "Command",
            "radar", "Radar", "shield", "Shield", "antinuke", "Antinuke",
            "nuke", "Nuke", "fabricator", "Fabricator", "constructor", "Constructor",
            "tank", "Tank", "artillery", "Artillery", "mech", "Mech",
            "infantry", "Infantry", "soldier", "Soldier", "cannon", "Cannon",
            "hover", "Hover", "spider", "Spider", "crawler", "Crawler",
            "bot", "Bot", "droid", "Droid", "vessel", "Vessel",
            "ship", "Ship", "sub", "Sub", "boat", "Boat", "naval", "Naval",
            "sea", "Sea", "destroyer", "Destroyer", "battleship", "Battleship",
            "frigate", "Frigate", "cruiser", "Cruiser", "carrier", "Carrier",
            "resource", "Resource", "mine", "Mine", "tree", "Tree", "rock", "Rock",
            "crystal", "Crystal", "oil", "Oil", "metal", "Metal"
        ];
        for (var i = 0; i < excludeKeywords.length; i++) {
            if (name.indexOf(excludeKeywords[i]) >= 0) return false;
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
            "drone", "Drone", "scout", "Scout"
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

        // 计算敌方中心
        var enemyCenter = { x: 0, y: 0 };
        for (var i = 0; i < enemies.length; i++) {
            enemyCenter.x += enemies[i].field_4227;
            enemyCenter.y += enemies[i].field_4228;
        }
        enemyCenter.x /= enemies.length;
        enemyCenter.y /= enemies.length;

        // 固定分组
        var currentDisruptors = [];
        var currentMain = [];
        var unassigned = [];

        for (var i = 0; i < allUnits.length; i++) {
            var h = unitHash(allUnits[i]);
            if (disruptorHashes[h]) {
                currentDisruptors.push(allUnits[i]);
            } else if (mainHashes[h]) {
                currentMain.push(allUnits[i]);
            } else {
                unassigned.push(allUnits[i]);
            }
        }

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

        // 只锁最近1个目标
        var focusTarget = null;
        var focusTargetD = Infinity;
        for (var k = 0; k < enemies.length; k++) {
            var d = dist(mainAvgX, mainAvgY, enemies[k].field_4227, enemies[k].field_4228);
            if (d < focusTargetD) {
                focusTargetD = d;
                focusTarget = enemies[k];
            }
        }

        // ========== 主力群：圆周运动 ==========
        if (focusTarget && currentMain.length > 0) {
            var fx = focusTarget.field_4227;
            var fy = focusTarget.field_4228;

            for (var i = 0; i < currentMain.length; i++) {
                var u = currentMain[i];
                var h = unitHash(u);
                var ux = u.field_4227, uy = u.field_4228;
                var hp = getHpRatio(u);

                if (hp < RETREAT_HP_RATIO) {
                    retreatToBase(u, game);
                    continue;
                }

                // 获取或初始化圆周运动状态
                var state = orbitStates[h];
                if (!state) {
                    var initAngle = Math.atan2(uy - fy, ux - fx);
                    state = {
                        angle: initAngle,
                        dir: (i % 2 === 0) ? 1 : -1
                    };
                    orbitStates[h] = state;
                }

                // 更新角度
                state.angle += ORBIT_SPEED * state.dir;

                // 计算圆周目标位置
                var tx = fx + Math.cos(state.angle) * ORBIT_RADIUS;
                var ty = fy + Math.sin(state.angle) * ORBIT_RADIUS;

                moveUnit(u, tx, ty, game);
            }
        }

        // ========== 干扰机：圆周运动（反向） ==========
        if (focusTarget && currentDisruptors.length > 0) {
            var fx = focusTarget.field_4227;
            var fy = focusTarget.field_4228;

            for (var i = 0; i < currentDisruptors.length; i++) {
                var u = currentDisruptors[i];
                var h = unitHash(u);
                var ux = u.field_4227, uy = u.field_4228;
                var hp = getHpRatio(u);

                if (hp < RETREAT_HP_RATIO) {
                    retreatToBase(u, game);
                    continue;
                }

                // 获取或初始化圆周运动状态
                var state = orbitStates[h];
                if (!state) {
                    var initAngle = Math.atan2(uy - fy, ux - fx);
                    // 干扰机默认反向运动
                    state = {
                        angle: initAngle,
                        dir: (i % 2 === 0) ? -1 : 1
                    };
                    orbitStates[h] = state;
                }

                // 更新角度
                state.angle += ORBIT_SPEED * state.dir;

                // 计算圆周目标位置
                var tx = fx + Math.cos(state.angle) * ORBIT_RADIUS;
                var ty = fy + Math.sin(state.angle) * ORBIT_RADIUS;

                moveUnit(u, tx, ty, game);
            }
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
