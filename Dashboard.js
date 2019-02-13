var http = require('http');
var url = require('url');
const fs = require("fs");
const Web3 = require('web3');
const Tx = require('ethereumjs-tx');

//global node parameters
const MY_ADDRESS = '0xC14BbA1b6CC582BBB6B554a5c0821C619CFD42c4';
const MY_PRIVATE_KEY = Buffer.from('099e8dc1316d838865648e3df3698e7a2037b6c81f270cc075a415b4a8ca6270', 'hex');
const MAINNET_URL = "ws://localhost:8546";
const BRIDGE_SOURCE_FILE = "./bin/BridgeMain.json";
const TOKEN_SOURCE_FILE = "./bin/BridgedToken.json";

var _web3_main = new Web3(new Web3.providers.WebsocketProvider(MAINNET_URL));
var _web3_side = new Web3(new Web3.providers.WebsocketProvider('ws://localhost:8548'));
var _bridge_main = '0xb5df18126ec2f5c4e100e8ddfc81e67bce1e0b56';
var _bridge_side = '0xbb1ceff9b9795da346032ee7fafcfd2e5c140f48';

// contracts json contains compiled bridge contract
let source = fs.readFileSync(BRIDGE_SOURCE_FILE);
let bridge_contract = JSON.parse(source);
source = fs.readFileSync(TOKEN_SOURCE_FILE);
let token_contract = JSON.parse(source);

// user input parameters
var side_url = "";

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
        side_url = req.query.url;
        console.log("Creating bridge with node " + side_url);
    
        _web3_side = new Web3(new Web3.providers.WebsocketProvider(side_url));
    
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
            node: side_url,
            mainAddress: _bridge_main,
            sideAddress: _bridge_side
        }
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

async function deployToken(web3_provider, tokenParams, bridge, deployer, key) {
    let token_dest = web3_provider.eth.Contract(token_contract.abi);
    let abiData = token_dest.deploy({
        data: token_contract.bytecode,
        arguments: [deployer, bridge, tokenParams.ticker, tokenParams.name, tokenParams.decimals, tokenParams.supply, tokenParams.locked] 
        //address _owner, address _bridge, string memory _symbol, string memory _name, uint8 _decimals, uint _initialSupply, bool locked
    })
    .encodeABI();
    return await deployContract(web3_provider, '0x' + abiData, deployer, key);
}

async function setOtherToken(web3_provider, token, otherToken, account, key) {
    let token_dest = web3_provider.eth.Contract(token_contract.abi, token);
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

        let mainPromise =  deployToken(_web3_main, tokenParams, _bridge_main, MY_ADDRESS, MY_PRIVATE_KEY).then(
            address => {
                tokenMain = address;
            }
        );
        tokenParams.locked = false;
        let sidePromise = deployToken(_web3_side, tokenParams, _bridge_side, MY_ADDRESS, MY_PRIVATE_KEY).then(
            address => {
                tokenSide = address;
            }
        );
        await Promise.all([mainPromise, sidePromise]);
    
        mainPromise = setOtherToken(_web3_main, tokenMain, tokenSide, MY_ADDRESS, MY_PRIVATE_KEY).then(
            val => {
                return addContract(_web3_main, _bridge_main, tokenMain, MY_ADDRESS, MY_PRIVATE_KEY);
            }
        );
        sidePromise = setOtherToken(_web3_side, tokenSide, tokenMain, MY_ADDRESS, MY_PRIVATE_KEY).then(
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

function selectAction(req, res) {
    switch (req.pathname) {
        case "":
        case "/":
            return displayPage("./Dashboard.html", res);
        case "/create_bridge":
            return createBridge(req, res);
        case "/create_token":
            return createToken(req, res);
        default:
            return displayPage("." + req.pathname, res)
    }
}

console.log("Starting server...");
http.createServer(function (req, res) {
    var q = url.parse(req.url, true);
    return selectAction(q, res);
}).listen(8080);