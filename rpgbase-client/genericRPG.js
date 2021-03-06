function GenericRPG(canvasTagId) {
  this._canvasTagId = canvasTagId;
  this._setupCallbacks = [];
  this._mapScreenDim = {};
  this._maps = [];
  this._mainMode = "map"; // "map" or "maze"
  this._subMode = null; // null, "menus", or "battle"
  this.player = null;
  this._vehicles = [];
  this._treasureStates = [];
}
GenericRPG.prototype = {
  serializableClassName: "Game",
  serializableFields: ["player", "_mainMode", "plotManager",
                       "_vehicles", "_treasureStates"],

  setMapScreenDimensions: function(squaresX, squaresY,
                                   pixelsX, pixelsY) {

    this._mapScreenDim = {squaresX: squaresX,
                          squaresY: squaresY,
                          pixelsX: pixelsX,
                          pixelsY: pixelsY};
  },
  
  _setUpMapScreen: function(animFrameTime) {
    var dim = this._mapScreenDim;
    this.mapScreen = new MapScreen(this.canvas,
                                   dim.squaresX,
                                   dim.squaresY,
                                   dim.pixelsX,
                                   dim.pixelsY,
                                   animFrameTime);
    this.mapScreen.setTileOffset({x: -0.5, y: -0.5});
    this.mapScreen.useAudioPlayer(this.audioPlayer);
  },

  _initEverything: function(options) {
    // Get the canvas from the HTML document:
    this.canvas = document.getElementById(this._canvasTagId);
    var ctx = this.canvas.getContext("2d");

    if (options.scaleFactor && options.scaleFactor != 1) {
      // Zoom in the canvas to given factor, without anti-aliasing:
      ctx.scale(options.scaleFactor, options.scaleFactor);
      ctx.mozImageSmoothingEnabled = false;
      ctx.webkitImageSmoothingEnabled = false;
      ctx.imageSmoothingEnabled = false;
    }

    // Create the loader (to load all images)
    this.loader = new AssetLoader();
    if (options.cursorImg) {  // menu cursor |>
      this._cursorImg = this.loader.add(options.cursorImg);
    }

    // Set the font image, if specified:
    if (options.fontImg) {
      CanvasTextUtils.setFontImg(this.loader.add("font.png"));
    }
    this._canvasWidth = options.canvasWidth; // required
    this._canvasHeight = options.canvasHeight; // required

    if (options._menuBaseHtmlElem) {
      this._menuBaseHtmlElem = options._menuBaseHtmlElem;
      this._menuStyle = "css";
    } else {
      this._menuStyle = "canvas";
    }
    var mapFrameRate = options.mapFrameRate ? options.mapFrameRate: 40; // ms
    var mazeFrameRate = options.mazeFrameRate ? options.mazeFrameRate: 100; // ms

    // Create the main game components (see the various setUp functions)
    this.mazeScreen = new FirstPersonMaze(ctx, this._canvasWidth,
                                          this._canvasHeight,
					  mazeFrameRate);

    this._setUpAudioPlayer();
    this._setUpMapScreen(mapFrameRate);

    if (options.partyInit) {
      options.partyInit(this.loader);
    }
    if (options.battleInit) {
      this.battleSystem = options.battleInit(this);
    }
    this.manuel = options.monsterInit(this.loader); // monster dictionary
    if (options.fieldMenuInit) {
      this.fieldMenu = options.fieldMenuInit(this, this._cursorImg);
    }
    this.overworld = options.overworldInit(this);
    this.registerMap(this.overworld);
    this.dialoglog = new Dialoglog(this._menuBaseHtmlElem,
				   this._cursorImg,
				   this._canvasWidth,
				   this._canvasHeight);
    this.dialoglog.setMenuPositions({msgLeft: 20,
                                     msgTop: 128});

    this.plotManager = new PlotManager();
    this.plotDlog = new PlotDialogSystem(this._menuBaseHtmlElem,
                                         this._cursorImg,
                                         this._canvasWidth,
                                         this._canvasHeight);

    this._setupInputDispatch();

    var self = this;

    if (this._menuStyle == "canvas") {
      // Draw any open canvas menus on top of map or maze screen
      this.mapScreen.afterRender(function(ctx) {
        if (self.fieldMenu) {
          self.fieldMenu.drawCanvasMenus(ctx);
        }
        self.dialoglog.drawCanvasMenus(ctx);
        self.plotDlog.drawCanvasMenus(ctx);
      });
      this.mazeScreen.afterRender(function(ctx) {
        self.fieldMenu.drawCanvasMenus(ctx);
        self.dialoglog.drawCanvasMenus(ctx);
        self.plotDlog.drawCanvasMenus(ctx);
      });
    }

    /* When a battle ends, return to map-screen style input, and
     * redraw the map screen: */
      // TODO CONSOLIDATE MODE SWITCHES
    if (this.battleSystem) {
      this.battleSystem.onClose(function(winLoseDraw) {
        if (self._mainMode == "map") {
          self.mapScreen.start();
        } 
        if (self._mainMode == "maze") {
          self.mazeScreen.start();
        }
      });
    }
  },

  _setupInputDispatch: function() {
    var self = this;
    var dispatcher = makeInputDispatcher(40); // TODO NO HARDCODE KEY REPEAT RATE
    
    var mazeKeyCallback = function(key) {
      var anim;
      switch (key) {
      case DOWN_ARROW:
        anim = self.mazeScreen.goBackward();
        break;
      case LEFT_ARROW:
        anim = self.mazeScreen.turnLeft();
        break;
      case UP_ARROW:
        anim = self.mazeScreen.goForward();
        break;
      case RIGHT_ARROW:
        anim = self.mazeScreen.turnRight();
        break;
      case CONFIRM_BUTTON:
        // If you're facing an NPC, talk to them!
        var npc = self.mazeScreen.getNPC();
        if (npc) {
	    // TODO CONSOLIDATE MODE SWITCHES
          npc.talk(dispatcher.menuMode("dialog"), self.player);
        }
        break;

      case CANCEL_BUTTON:
        // Pop open the field menu system
	  // TODO CONSOLIDATE MODE SWITCHES
        console.log("Opening field menu from maze");
        dispatcher.menuMode("menu").open(self.player);
        break;
      }
      if (anim) {
        dispatcher.waitForAnimation(anim);
        self.mazeScreen.animator.runAnimation(anim);
      }
    };

    var mapScreenKeyCallback = function(key) {
      // Frame-rate = one frame per 40 ms
      var delX = 0, delY =0;
      switch (key) {
      case DOWN_ARROW:
        delX = 0; delY = 1;
        break;
      case LEFT_ARROW:
        delX = -1; delY = 0;
        break;
      case UP_ARROW:
        delX = 0; delY = -1;
        break;
      case RIGHT_ARROW:
        delX = 1; delY = 0;
        break;
      case CONFIRM_BUTTON:
        // If you're facing an NPC, talk to them!
        var facingSpace = self.player.getFacingSpace();
        var npc = self.mapScreen.getNPCAt(facingSpace.x, 
                                          facingSpace.y);
        if (npc) {
	    // TODO CONSOLIDATE MODE SWITCHES
          npc.talk(dispatcher.menuMode("dialog"), self.player);
        }
        break;
      case CANCEL_BUTTON:
        // Pop open the field menu system
	  // TODO CONSOLIDATE MODE SWITCHES
        dispatcher.menuMode("menu").open(self.player);
        break;
      }

      if (delX != 0 || delY != 0) {
        // Animate the player moving, wait for animation to finish:
        var anim = self.player.move(delX, delY);
        dispatcher.waitForAnimation(anim);
        self.mapScreen.animate(anim);
      }
    };

    dispatcher.addMapMode("overworld", mapScreenKeyCallback);
    dispatcher.addMapMode("maze", mazeKeyCallback);
    if (self.fieldMenu) {
      dispatcher.addMenuMode("menu", self.fieldMenu);
    }
    if (self.battleSystem) {
      dispatcher.addMenuMode("battle", self.battleSystem);
    }
    dispatcher.addMenuMode("dialog", self.dialoglog);
    dispatcher.addMenuMode("plot", self.plotDlog);

    this.inputDispatcher = dispatcher;
  },

  loadMusicFiles: function(dictionary) {
      this._musicTracks = dictionary;
      for (var key in dictionary) {
	  this.audioPlayer.preload(dictionary[key]);
      }
  },

  _setUpAudioPlayer: function() {
    // The check box for turning audio on and off:
    var audioPlayer = new AudioPlayer();
    // For best results preload music files here:

    // TODO this toggle elem should be set in userland
    var checkAudioState = function() {
      if ($("#bgm-toggle").is(":checked")) {
        audioPlayer.enable();
      } else {
        audioPlayer.disable();
      }
    }
    checkAudioState();
    $("#bgm-toggle").click(checkAudioState);
    this.audioPlayer = audioPlayer;
  },
  
  setup: function(callback) {
    this._setupCallbacks.push(callback);
  },

  start: function(callback) {
    for (var i = 0; i < this._setupCallbacks; i++) {
      this._setupCallbacks[i](this);
    }

    var self = this;
    console.log("Gonna loadThemAll");
    // This is a common place for startup to fail, because if
    // any of the loading files doesnt' load, the callback never
    // gets called
    this.loader.loadThemAll(function() {
      console.log("Loaded them all");
	// TODO CONSOLIDATE MODE SWITCHES
      if (this._mainMode == "maze") {
        self.inputDispatcher.mapMode("maze");
        self.mazeScreen.start();
      } else {
        self.inputDispatcher.mapMode("overworld");
        self.mapScreen.start();
      }

      if (callback) {
          callback();
      }

    });

  },

  addTownToMap: function(theTownMap, x1, y1, x2, y2) {
    var self = this;
    /* Enter the town: */
    this.overworld.onStep({x: x1, y: y1}, function(pc, x, y) {
      self.mapScreen.setNewDomain(theTownMap);
      self.player.enterMapScreen(self.mapScreen, x2, y2);
      self.mapScreen.render();
    });
    /* To get back out of the town: */
    theTownMap.onStep({edge: "any"}, function(pc, x, y) {
      self.mapScreen.setNewDomain(self.overworld);
      self.player.enterMapScreen(self.mapScreen, x1, y1);
      self.mapScreen.render();
    });

    theTownMap.setMusicTrack(this._musicTracks["town"]);
    // TODO this should go in userland:
    theTownMap.getTileForCode = function(mapCode) {
	return {x:mapCode, y:DayNight};
    };
  },

  makeNPC: function(spriteSheet) {
    return new NPC(spriteSheet, this.mapScreen);
  },

  addNPCToTown: function(town, spriteSheet, spriteSliceX, 
		         spriteSliceY, dialogText, xPos, yPos,
		         wanders) {
    var newNPC = this.makeNPC(spriteSheet);
    if (wanders) {
      newNPC.wander();
    }
    newNPC.setSprite(spriteSliceX, spriteSliceY);
    newNPC.onTalk(function(dialog) {
      dialog.scrollText(dialogText);
    });
    town.addNPC(newNPC,xPos, yPos);
  },

  makeShop: function(spriteSheet, sliceX, sliceY, inventory, speech) {
    // TODO put "~" in userland,
    // TODO standardize pc/npc sprite dimensions
    return makeShop(spriteSheet,
                    this.mapScreen, 16, 24, 0, -8,
                    sliceX, sliceY, inventory, "~",
                    speech);
  },

  makeChurch: function(spriteSheet, spriteX, spriteY, price) {

    var priest = this.makeNPC(spriteSheet);
    priest.setSprite(spriteX, spriteY);
    priest.onTalk(function(dialog, player) {
	    dialog.open(player);
	    // make list of dead guys:
	    var deadGuys = [];
	    var party = player.getParty();
	    for (var i = 0; i < party.length; i++) {
		if (!party[i].isAlive()) {
		    deadGuys.push(party[i]);
		}
	    }
	    if (deadGuys.length == 0) {
		dialog.scrollText("COME SEE ME IF YOU NEED THE DEAD RAISED.");
	    } else {
		dialog.showPartyResources(player, "~");
		dialog.showMsg("WHO NEEDS REVIVING? IT'S " + price + " ~.");
		var menu = dialog.makeMenu();
		menu.setTitle("DEADITES");
		for (var i = 0; i < deadGuys.length; i++) {
		    (function(pc) {
			menu.addCommand(pc.name,
                          function() {
			    if (player.hasResource("~", price)) {
				player.spendResource("~", price);
				pc.revive();
				pc.setStat("hp", 1);
				player.marchInOrder();
				dialog.popMenu();
				dialog.scrollText(pc.name + " IS REVIVED! PRAISE NINTENDO ACCEPTABLE SUBSTITUTE FOR JESUS!");
			    } else {
				dialog.scrollText("YOU CAN'T AFFORD THAT, SORRY.");
			    }
			  });
		    })(deadGuys[i]);
		}
		dialog.pushMenu(menu);
	    }
	});
    return priest;
  },

  makeInn: function(spriteSheet, spriteX, spriteY, pricePer) {
    var innkeeper = this.makeNPC(spriteSheet);
    innkeeper.onTalk(function(dialog, player) {
	    dialog.open(player);
	    dialog.showPartyResources(player, "~");
	    var totalPrice = pricePer * player.getAliveParty().length;
	    dialog.showMsg("FOR YOU TO STAY THE NIGHT WILL BE " + totalPrice + "~.");

	    dialog.yesOrNo(function(answer) {
		    if (answer) {
			if (player.hasResource("~", totalPrice)) {
			    player.forEachAliveMember(function(pc) {
				    pc.takeEffect("fullheal", {});
				    // see moonserpent-party for where "fullheal" is
				    // defined
				});
			    // TODO black out screen and play lullaby
			    player.spendResource("~", totalPrice);
			    dialog.popMenu();
			    dialog.scrollText("THANK YOU, COME AGAIN.");
			} else {
			    dialog.popMenu();
			    dialog.scrollText("YOU CAN'T AFFORD THAT, SORRY.");
			}
		    } else {
			dialog.popMenu();
			dialog.scrollText("HOPE TO SEE YOU AGAIN!");
		    }
		});
	});
    innkeeper.setSprite(spriteX, spriteY);
    return innkeeper;
  },

  connectMazeToOverworld: function(maze, overworldX, overworldY,
				   mazeX, mazeY, facing) {
    var self = this;
      // assymmetry: when entering maze, put you on the space
      // in FRONT of the stairs, but don't exit maze until you
      // step ONTO the stairs.
      var entryX = mazeX;
      var entryY = mazeY;
      switch (facing) {
      case "e": entryX ++; break;
      case "w": entryX --; break;
      case "n": entryY --; break;
      case "s": entryY ++; break;
      }

    // TODO I don't think .unload() is getting called for the
    // map when you move to a maze, or vice versa.

    // TODO maze needs to start its own music when you enter (and when
    // a fight ends!) neither of which is happening currently
    this.overworld.onStep({x: overworldX, y: overworldY},
      function(pc, x, y, landType) {
        // TODO CONSOLIDATE MODE SWITCHES
        self._mainMode = "maze";
        self.inputDispatcher.mapMode("maze");
        self.mapScreen.stop();
        self.mazeScreen.loadMaze(maze);
        self.mazeScreen.setLightLevel(0); // TODO this should be set in MoonSerpentCave.
        self.mazeScreen.enterPlayer(self.player,
				    entryX,
				    entryY,
				    facing);
        self.mazeScreen.start();
      });

    maze.onStep({x: mazeX, y: mazeY},
        // TODO CONSOLIDATE MODE SWITCHES
        function(pc, x, y) {
	  // TODO pc argument is bogus, don't use it
        self._mainMode = "map";
	  self.inputDispatcher.mapMode("overworld");
	  self.mazeScreen.stop();
          self.mapScreen.setNewDomain(self.overworld); // in case last domain was not overworld
	  self.mapScreen.start();
	  self.player.enterMapScreen(self.mapScreen,
                               overworldX,
                               overworldY);
        });
  },

  startEncounter: function(encounter, landType) {
    var self = this;

    if (encounter.canHappen) {
      //special encounters have conditions
      if (!encounter.canHappen(self.player)) {
        // if conditions are false, don't start encounter
        return; 
      }
    }
    // TODO CONSOLIDATE MODE SWITCHES
    self.inputDispatcher.menuMode("battle");
    if (self._mainMode == "maze") {
      self.mazeScreen.stop();
    }
    if (self._mainMode == "map") {
      self.mapScreen.stop();
    }

    if (this._musicTracks && this._musicTracks["battle"]) {
	self.audioPlayer.changeTrack(this._musicTracks["battle"], true);
    }
    self.battleSystem.startBattle(self.player, encounter, landType);
  },

  recordEmptyChests: function(map) {
    var mapId = map.getId();
    var npcs = map.getAllNPCs();
    this._treasureStates[mapId] = [];
    for (var i = 0; i < npcs.length; i++) {
      if (npcs[i]._taken) { // only chests have this property
        // TODO don't break encapsulation here; make a better way of
        // querying an NPC whether it needs to save state.
        
        // record position of opened chest:
        var pos = npcs[i].getPos();
        this._treasureStates[mapId].push([pos.x, pos.y]);
      }
    }
  },

  applyEmptyChests: function(map) {
    var mapId = map.getId();
    var emptyChests = this._treasureStates[mapId];
    if (emptyChests) {
      for (var i = 0; i < emptyChests.length; i++) {
        var chest = map.getNPCAt(emptyChests[i][0],
                                 emptyChests[i][1]);
        if (chest && chest.makeEmpty) {
          chest.makeEmpty();
        }
      }
    }
  },

  registerMap: function(map) {
    this._maps[map.getId()] = map;
    var self = this;

    map.onLoad(function() {
      self.applyEmptyChests(map);
      // Look up this map in treasureStates, and empty any
      // treasure chests that have already been gotten.
      // (Note: to work correctly this must be called AFTER the
      // callback that instantiates all the treasure chests...)
    });

    map.onUnload(function() {
      // Save gotten chests to treasureStates, THEN removeAllNPCs.
      // removing all NPCs must happen LAST.
      // so userland should NOT register a callback to remove all NPCs.
      // Do that here instead.
      self.recordEmptyChests(map);
      map.removeAllNPCs(); // TODO get rid of this call in all userland code
    });

  },

  getMapById: function(id) {
    return this._maps[id];
  },

  reorderParty: function() {
    var party = this.player.party;
    var player = this.player;

    if (party.length < 2) {
      this.fieldMenu.showMsg("THERE'S ONLY ONE OF YOU!");
      return;
    }
    var newOrder = [];
    var labels = ["1ST?", "2ND?", "3RD?"]; // todo more labels
  
    // this is maybe a useful utility function...
    var without = function(array, elem) {
      var newArray = array.slice();
      newArray.splice(newArray.indexOf(elem), 1);
      return newArray;
    };

    var setPartyOrder = function(newOrder) {
      player.party = newOrder;
      for (var i = 0; i < player.party.length; i++) {
        player.party[i]._marchOrder = i;
      }
      player.marchInOrder();
    };

    // recursive:
    this.fieldMenu.saveStackDepth();
    var subReorder = function(menus, party, depth) {
      if (party.length == 1) {
        newOrder[depth] = party[0];
        menus.restoreStackDepth();
        setPartyOrder(newOrder);
        return;
      } else {
        menus.chooseOne(labels[depth], party, function(charNext) {
          newOrder[depth] = charNext;
          var remainingParty = without(party, charNext);
          subReorder(menus, remainingParty, depth + 1);
        });
      }
    };

    subReorder(this.fieldMenu, party, 0);
  },

  getCurrentMapId: function() {
    if (this._mainMode == "maze") {
        return this.mazeScreen.getCurrentMapId();
    } else {
        return this.mapScreen.getCurrentMapId();
    }
  },

  onSerialize: function(jsonobj) {
    console.log("genericRPG.onSerialize called");
    jsonobj._mapId = this.getCurrentMapId();

    /* x-y location of first player in party will be stored
     * in playerX, playerY; whole party will re-enter map at that
     * point. (TODO: We could make _x and _y serializable on the
     * PlayerCharacter class instead, would that be better?) */
    var pos = this.player.getAliveParty()[0].getPos();
    jsonobj._playerX = pos.x;
    jsonobj._playerY = pos.y;

    // Ensure currently loaded map records its treasure states:
    this.recordEmptyChests(this.getMapById(jsonobj._mapId));
    // TODO write the treasure-states dict:

    jsonobj["_treasureStates"] = {};
    for (var key in this._treasureStates) {
      jsonobj["_treasureStates"][key] = this._treasureStates[key].slice();
    }

    // Record if I'm on a vehicle:
    if (this.player.inVehicle) {
      jsonobj["embarked_vehicle"] = this.player.inVehicle._id; // encapsulation breaky
    } else {
      jsonobj["embarked_vehicle"] = "";
    }

    // why does onSerialize happen AFTER basic serialization? Wouldn't it make
    // more sense to do this first? Longterm refactor.
  },

  onDeserialize: function(jsonobj) {
    var map = this.getMapById(jsonobj._mapId);
    console.log("MapID to load is " + jsonobj._mapId);

    if (this._mainMode == "maze") {
        this.mazeScreen.loadMaze(map);
        this.mazeScreen.enterPlayer(this.player,
                                    jsonobj._playerX,
                                    jsonobj._playerY, "e");

        // (TODO run the following only if
        // the game has already started in map mode -- it
        // will break othrewise)
        this.inputDispatcher.mapMode("maze");
        this.mapScreen.stop();
        this.mazeScreen.start();
        // TODO load direction
        // player is facing in maze
    } else {
        this.mapScreen.setNewDomain(map);
        this.player.enterMapScreen(this.mapScreen,
                                   jsonobj._playerX,
                                   jsonobj._playerY);
    }
    this.player.marchInOrder();

    // Load the treasure-states dict here:
    this._treasureStates = {};
    for (var key in jsonobj["_treasureStates"]) {
      this._treasureStates[key] = jsonobj["_treasureStates"][key].slice();
    }
    // then apply treasure states for currently loaded map!
    this.applyEmptyChests(map);

    // Place all vehicles restored as part of the save file onto the
    // overworld map.
    this.overworld._vehicles = this._vehicles.slice();
    // (Yes this means the overworld has a copy of the array.
    // Overworld's copy are the vehicles present in the overworld,
    // gameengine's copy is all vehicles ever.)

    // Any game-specific userland customization of vehicles must
    // occur AFTER this restoration.

    // Which vehicle (if any) is the party aboard?
    var embarked = jsonobj["embarked_vehicle"];
    if (embarked && embarked != "") {
      var vehicle = this.getVehicle(embarked);
      this.player.inVehicle = vehicle;
      vehicle._playerOnboard = this.player; // super encapsulation breaky
    }
  },

  inMaze: function() {
    return (this._mainMode == "maze");
  },

  startPlotEvent: function(event) {
      // TODO CONSOLIDATE MODE SWITCHES
    this.inputDispatcher.menuMode("plot");
    event.play(this.player, this.mapScreen);
  },
   
  setCursorImg: function(cursorImg) {
    this._cursorImg = cursorImg;
  },

  nonBattleDamage: function(pc, dmgAmount) {
    // taking damage outside of battle, e.g. traps, poison
    pc.modifyStat("hp", (-1) * dmgAmount);
    // Flash screen red:
    if (this._mainMode == "maze") {
        this.mazeScreen.flash("red", 3); //TODO not implemented
    } else {
        this.mapScreen.flash("red", 3);
    }
    // TODO if multiple pcs are taking damage this flashes once
    // for each -- detect this case and combine.
    if (pc.getStat("hp") <= 0) {
      pc.die();
      this.player.marchInOrder();
      this.inputDispatcher.menuMode("dialog").open(this.player);
      this.dialoglog.scrollText(pc.name + " HAS DIED.");
      // check for TPK and do game-over screen!
      var self = this;
      this.dialoglog.onClose(function() {
        if (self.player.getAliveParty().length == 0) {
            if (self.doGameOver) {
                // defined in userland -- a little awkward.
                self.doGameOver();
            }
        }
      });
    }
  },

  scrollFieldMessage: function(text) {
      this.inputDispatcher.menuMode("dialog").scrollText(text);
  },

  addVehicle: function(vehicle, x, y) {
      // add vehicle to our master list and also place it on the overworld map:
      this.overworld.addVehicle(vehicle);
      this._vehicles.push(vehicle);
  },

  getVehicle: function(id) {
    for (var i = 0; i < this._vehicles.length; i++) {
	    if (id == this._vehicles[i]._id) {
        return this._vehicles[i];
      }
    }
    return null;
  },

  makePlotEvent: function(flagName) {
    return new ScriptedEvent(this.plotManager, flagName, this.plotDlog);
  }

};
SerializableMixin(GenericRPG);
