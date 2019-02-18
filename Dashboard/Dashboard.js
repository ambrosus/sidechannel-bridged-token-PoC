var http = require('http');
var url = require('url');
const fs = require("fs");
const Web3 = require('web3');
const Tx = require('ethereumjs-tx');

let configFile = fs.readFileSync("./Dashboard/Dashboard.conf");
let config = JSON.parse(configFile);

//global node parameters
const MY_ADDRESS = config.address;
const MY_PRIVATE_KEY = Buffer.from(config.key, 'hex');
const MAINNET_URL = config.mainnet;
var SIDECHAIN_URL;
var BRIDGE_MAIN_ADDRESS;
var BRIDGE_SIDE_ADDRESS;
if (config.bridge) {
    SIDECHAIN_URL = config.bridge.node;
    BRIDGE_MAIN_ADDRESS = config.bridge.mainAddress;
    BRIDGE_SIDE_ADDRESS = config.bridge.sideAddress;
}
const BRIDGE_SOURCE_FILE = config.bridgeContract;
const MAIN_TOKEN_SOURCE_FILE = config.mainTokenContract;
const SIDE_TOKEN_SOURCE_FILE = config.sideTokenContract;

//global variables
var _web3_main = new Web3(new Web3.providers.WebsocketProvider(MAINNET_URL));
var _web3_side =  SIDECHAIN_URL != undefined ? new Web3(new Web3.providers.WebsocketProvider(SIDECHAIN_URL)) : undefined;
var _bridge_main = BRIDGE_MAIN_ADDRESS;
var _bridge_side = BRIDGE_SIDE_ADDRESS;

// contracts json contains compiled contracts
let source = fs.readFileSync(BRIDGE_SOURCE_FILE);
let bridge_contract = JSON.parse(source);
source = fs.readFileSync(MAIN_TOKEN_SOURCE_FILE);
let main_token_contract = JSON.parse(source);
source = fs.readFileSync(SIDE_TOKEN_SOURCE_FILE);
let side_token_contract = JSON.parse(source);

function saveConfig() {
    var conf = JSON.stringify(config);
    fs.writeFileSync('./Dashboard.conf', conf, 'utf8');
}

function displayPage(filename, res) {
    fs.readFile(filename, function(err, data) {
        if (err) {
          res.writeHead(404, {'Content-Type': 'text/html'});
          return res.end("404 Not Found");
        }
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.write(data);
        return res.end();
    });
}

function returnJson(json, res) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify(json));
    return res.end();
}

//
//let contract = web3.eth.Contract(abi, address);
//let abiData = contract.methods.method(params).encodeABI();
async function sendRawTx(provider, abiData, account, key, dest) {
    let nonce = await provider.eth.getTransactionCount(account);
    var rawTx = {
        nonce: nonce,
        from: account,
        to: dest,
        data: abiData,
        gasPrice: '0x09184e72a000',
        gasLimit: '0x5AA710',
      };
    const tx = new Tx(rawTx);
    tx.sign(key);
    return await provider.eth.sendSignedTransaction('0x' + tx.serialize().toString('hex'))
}

async function deployContract(web3_provider, code, deployer, key) {
    console.log("deploying contracts");
    var address = (await sendRawTx(web3_provider, code, deployer, key)).contractAddress;
    console.log("deployed " + address);
    return address;
}

async function addOracle(web3_provider, bridge, oracle, account, key) {
    let bridge_dest = web3_provider.eth.Contract(bridge_contract.abi, bridge);
    let abiData = bridge_dest.methods.addOracle(oracle).encodeABI();
    await sendRawTx(web3_provider, abiData, account, key, bridge);
}

async function addContract(web3_provider, bridge, contract, account, key) {
    let bridge_dest = web3_provider.eth.Contract(bridge_contract.abi, bridge);
    let abiData = bridge_dest.methods.addContract(contract).encodeABI();
    await sendRawTx(web3_provider, abiData, account, key, bridge);
}

async function createBridge(req, res) {
    try {
        console.log("Creating bridge with node " + req.query.url);
    
        _web3_side = new Web3(new Web3.providers.WebsocketProvider(req.query.url));
    
        let mainPromise = deployContract(_web3_main, '0x' + bridge_contract.bytecode, MY_ADDRESS, MY_PRIVATE_KEY).then(
            address => {
                _bridge_main = address;
                return addOracle(_web3_main, _bridge_main, MY_ADDRESS, MY_ADDRESS, MY_PRIVATE_KEY);
            }
        );
        let sidePromise = deployContract(_web3_side, '0x' + bridge_contract.bytecode, MY_ADDRESS, MY_PRIVATE_KEY).then(
            address => {
                _bridge_side = address;
                return addOracle(_web3_side, _bridge_side, MY_ADDRESS, MY_ADDRESS, MY_PRIVATE_KEY);
            }
        );
        await Promise.all([mainPromise, sidePromise]);
        console.log("Done!");

        var bridgeData = {
            node: req.query.url,
            mainAddress: _bridge_main,
            sideAddress: _bridge_side
        }
        config.bridge = bridgeData;
        saveConfig();
        console.log(bridgeData);
        return returnJson(bridgeData, res)
    } catch (error) {
        console.log(error);
        var bridgeData = {
            err: error.toString()
        }
        return returnJson(bridgeData, res)
    }
}

async function deployToken(web3_provider, contract, tokenParams, bridge, deployer, key) {
    let token_dest = web3_provider.eth.Contract(contract.abi);
    let abiData = token_dest.deploy({
        data: contract.bytecode,
        arguments: [deployer, bridge, tokenParams.ticker, tokenParams.name, tokenParams.decimals, tokenParams.supply, tokenParams.locked] 
        //address _owner, address _bridge, string memory _symbol, string memory _name, uint8 _decimals, uint _initialSupply, bool locked
    })
    .encodeABI();
    return await deployContract(web3_provider, '0x' + abiData, deployer, key);
}

async function setOtherToken(web3_provider, contract, token, otherToken, account, key) {
    let token_dest = web3_provider.eth.Contract(contract.abi, token);
    let abiData = token_dest.methods.setOtherToken(otherToken).encodeABI();
    await sendRawTx(web3_provider, abiData, account, key, token);
}

async function createToken(req, res) {
    try {
        if (!_web3_side) {
            throw "Sidechain not provided";
        }
        console.log("Deploying tokens");
        var tokenParams = {
            name: req.query.name,
            ticker: req.query.ticker,
            supply: parseInt(req.query.supply, 10),
            decimals: parseInt(req.query.decimals, 10),
            locked: true
        };

        var tokenMain;
        var tokenSide;

        let mainPromise = deployToken(_web3_main, main_token_contract, tokenParams, _bridge_main, MY_ADDRESS, MY_PRIVATE_KEY).then(
            address => {
                tokenMain = address;
            }
        );
        tokenParams.locked = false;
        let sidePromise = deployToken(_web3_side, side_token_contract, tokenParams, _bridge_side, MY_ADDRESS, MY_PRIVATE_KEY).then(
            address => {
                tokenSide = address;
            }
        );
        await Promise.all([mainPromise, sidePromise]);
    
        mainPromise = setOtherToken(_web3_main, main_token_contract, tokenMain, tokenSide, MY_ADDRESS, MY_PRIVATE_KEY).then(
            val => {
                return addContract(_web3_main, _bridge_main, tokenMain, MY_ADDRESS, MY_PRIVATE_KEY);
            }
        );
        sidePromise = setOtherToken(_web3_side, side_token_contract, tokenSide, tokenMain, MY_ADDRESS, MY_PRIVATE_KEY).then(
            val => {
                return addContract(_web3_side, _bridge_side, tokenSide, MY_ADDRESS, MY_PRIVATE_KEY);
            }
        );
        await Promise.all([mainPromise, sidePromise]);
        console.log("Done!");

        var tokenData = {
            main: tokenMain,
            side: tokenSide
        };
        console.log(tokenData);
        return returnJson(tokenData, res)
    } catch (error) {
        console.log(error);
        var tokenData = {
            err: error.toString()
        };
        return returnJson(tokenData, res)
    }
}

function getBridge(req, res) {
    if (_web3_side && _bridge_side && _bridge_main) {
        var bridgeData = {
            node: config.bridge.node,
            mainAddress: config.bridge.mainAddress,
            sideAddress: config.bridge.sideAddress
        }
        return returnJson(bridgeData, res)
    } else {
        return returnJson({}, res)
    }
}

function selectAction(req, res) {
    switch (req.pathname) {
        case "":
        case "/":
            return displayPage("./Dashboard/Dashboard.html", res);
        case "/create_bridge":
            return createBridge(req, res);
        case "/create_token":
            return createToken(req, res);
        case "/get_bridge":
            return getBridge(req, res);
        default:
            return displayPage("." + req.pathname, res)
    }
}

console.log("Starting server...");
http.createServer(function (req, res) {
    var q = url.parse(req.url, true);
    return selectAction(q, res);
}).listen(8080);